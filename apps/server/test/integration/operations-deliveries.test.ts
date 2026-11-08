import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connectDatabase } from '../../src/db/client';
import {
  areaNotes,
  conversations,
  deliveryJobs,
  jobStops,
  orderExchanges,
  productVariants,
  timers as timersTable,
} from '../../src/db/schema';
import { withShop } from '../../src/db/with-shop';
import { noteZone } from '../../src/modules/delivery/area-notes.domain';
import { OFFER_UNANSWERED_TIMER } from '../../src/modules/drivers/job-offers.service';
import { DELIVERY_LATE_TIMER } from '../../src/modules/drivers/trips.service';
import { RESCHEDULE_TIMER } from '../../src/modules/operations/rescheduling.service';
import { createOperationsBot } from '../fakes/operations-bot';
import {
  buttonsOf,
  calls,
  customerPin,
  done,
  operationsWorld,
  tap,
  text,
  userOf,
} from '../fakes/operations-fixtures';
import { ScriptedModel, type ScriptedTurn } from '../fakes/scripted-model';
import { testDatabaseUrl } from './test-database';

const { db, close } = connectDatabase(testDatabaseUrl);
afterAll(close);

const script: ScriptedTurn[] = [];
const model = new ScriptedModel(script);
const world = createOperationsBot(db, model, () => new Date());
const { bot, timers, services } = world;
const fixtures = operationsWorld(db, world);
const { sentTo, lastTo, answers, setUpShop, addDriver, paidOrder, offerIdFor } = fixtures;
const { onTheWay, deliver, decisionsOf, approvalButton } = fixtures;

const owner = 660001;
const ownerUser = userOf(owner, 'Owner');
const abebe = userOf(660101, 'Abebe', 'abebe_moto');
let shop = { shopId: '', size42: '', size43: '' };

const statusOf = async (orderId: string) =>
  (await services.orders.get(shop.shopId, orderId)).status;

const shopRows = <T>(work: Parameters<typeof withShop<T>>[2]) => withShop(db, shop.shopId, work);

/** Makes the timer due and runs the tick, as cron-job.org would after its time passed. */
async function fire(kind: string, targetId: string): Promise<void> {
  await db
    .update(timersTable)
    .set({ dueAt: sql`now()` })
    .where(and(eq(timersTable.kind, kind), eq(timersTable.targetId, targetId)));
  await timers.tick();
}

beforeAll(async () => {
  shop = await setUpShop(owner, { size42: 50, size43: 2 });
  await addDriver(shop.shopId, abebe);
});

beforeEach(async () => {
  expect(script).toEqual([]);
  // Only the timers a test makes due should run on its tick.
  await db.update(timersTable).set({ status: 'done' }).where(eq(timersTable.status, 'pending'));
});

describe('a driver whose customer is not answering', () => {
  const hana = userOf(660201, 'Hana');
  let orderId = '';
  let jobId = '';

  it("gives the customer the driver's number and moves the order unless they reply", async () => {
    orderId = await paidOrder(shop.shopId, shop.size42, hana);
    jobId = await onTheWay(abebe);
    script.push(
      calls(
        [
          'message_customer',
          {
            orderId,
            text: 'Your driver is at your door, please call him.',
            includeDriverPhone: true,
          },
        ],
        ['reschedule_delivery', { orderId, waitMinutes: 15 }],
      ),
      done,
    );

    await bot.handleUpdate(text(abebe, 'ደንበኛው ስልክ አያነሳም'));

    expect(lastTo(hana.id)?.text).toContain('please call him');
    expect(lastTo(hana.id)?.text).toContain(`Driver Abebe: +2519${String(abebe.id)}`);
    expect(lastTo(abebe.id)?.text).toContain('Buchi is on it');
    const situation = JSON.stringify(model.requests.at(-2)?.contents);
    expect(situation).not.toContain(`+2519${String(abebe.id)}`);
    expect(situation).not.toContain(String(customerPin.latitude));
    expect(await statusOf(orderId)).toBe('out_for_delivery');

    const requests = model.requests.length;
    await fire(RESCHEDULE_TIMER, orderId);

    // The wait is a code timer: moving the order does not wake the agent again.
    expect(model.requests).toHaveLength(requests);
    const order = await services.orders.get(shop.shopId, orderId);
    expect(order).toMatchObject({ status: 'paid', deliveryType: 'saver' });
    expect(lastTo(abebe.id)?.text).toContain('continue your route');
    expect(lastTo(hana.id)?.text).toContain('comes with the next delivery run');
    const [job] = await shopRows((tx) =>
      tx.select().from(deliveryJobs).where(eq(deliveryJobs.id, jobId)),
    );
    expect(job?.status).toBe('delivered');
    expect(
      await shopRows((tx) => tx.select().from(jobStops).where(eq(jobStops.orderId, orderId))),
    ).toEqual([]);
    // The test database is shared, so another file's Saver run must not pick this order up.
    await services.orders.transition(shop.shopId, orderId, 'dispatched', 'system', 'Test cleanup');
  });

  it('keeps the order on the trip when the customer writes back in time', async () => {
    const liya = userOf(660202, 'Liya');
    const kept = await paidOrder(shop.shopId, shop.size42, liya);
    await onTheWay(abebe);
    script.push(calls(['reschedule_delivery', { orderId: kept, waitMinutes: 15 }]), done);
    await bot.handleUpdate(text(abebe, 'The customer does not pick up'));
    await services.conversations.recordTurns(
      shop.shopId,
      { telegramUserId: liya.id, name: 'Liya' },
      [{ role: 'customer', text: 'Coming down now!' }],
    );

    await fire(RESCHEDULE_TIMER, kept);

    expect(await statusOf(kept)).toBe('out_for_delivery');
    await deliver(abebe);
    expect(await statusOf(kept)).toBe('delivered');
  });
});

describe('a driver who reports a delay', () => {
  it('sends the customer a new arrival time and saves the report for the area', async () => {
    const sara = userOf(660301, 'Sara');
    const orderId = await paidOrder(shop.shopId, shop.size42, sara);
    const jobId = await onTheWay(abebe);
    script.push(
      calls(
        ['update_eta', { orderId, minutes: 30 }],
        ['save_area_note', { jobId, note: 'Traffic jam at Megenagna', validHours: 3 }],
      ),
      done,
    );

    await bot.handleUpdate(text(abebe, 'Stuck at Megenagna, 30 minutes late'));

    expect(lastTo(sara.id)?.text).toContain('should arrive around');
    // The reply carries the stop's buttons, since only a tap confirms the delivery.
    const reply = lastTo(abebe.id);
    expect(reply?.text).toContain('Buchi is on it');
    expect(reply?.text).toContain('Sara: tap Delivered');
    expect(buttonsOf(reply)).toHaveLength(2);
    expect(buttonsOf(reply)[0]).toMatch(/^job:delivered:/);
    const notes = await shopRows((tx) => tx.select().from(areaNotes));
    expect(notes).toMatchObject([
      { zone: noteZone(customerPin), note: 'Traffic jam at Megenagna', source: 'driver' },
    ]);
    const hours = ((notes[0]?.expiresAt.getTime() ?? 0) - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(2.9);

    script.push(done);
    await fire(DELIVERY_LATE_TIMER, jobId);
    const lateSituation = JSON.stringify(model.requests.at(-1)?.contents);
    expect(lateSituation).toContain('running late');
    expect(lateSituation).toContain('Traffic jam at Megenagna');
    await deliver(abebe);
  });
});

describe('a late trip', () => {
  it('wakes the agent once, and not after the trip ended', async () => {
    const dawit = userOf(660401, 'Dawit');
    const orderId = await paidOrder(shop.shopId, shop.size42, dawit);
    const jobId = await onTheWay(abebe);
    const [timer] = await db
      .select()
      .from(timersTable)
      .where(and(eq(timersTable.kind, DELIVERY_LATE_TIMER), eq(timersTable.targetId, jobId)));
    // 15 road minutes plus 15 minutes of grace.
    expect((timer?.dueAt.getTime() ?? 0) - Date.now()).toBeGreaterThan(29 * 60_000);
    script.push(
      calls(
        ['message_driver', { jobId, text: 'How is the delivery going?' }],
        ['update_eta', { orderId, minutes: 20 }],
      ),
      done,
    );

    await fire(DELIVERY_LATE_TIMER, jobId);

    expect(lastTo(abebe.id)?.text).toBe('💬 How is the delivery going?');
    expect(lastTo(dawit.id)?.text).toContain('should arrive around');
    await deliver(abebe);
    const requests = model.requests.length;
    await db
      .update(timersTable)
      .set({ status: 'pending' })
      .where(eq(timersTable.id, timer?.id ?? ''));
    await fire(DELIVERY_LATE_TIMER, jobId);
    expect(model.requests).toHaveLength(requests);
  });
});

describe('no driver accepting within 10 minutes', () => {
  it('asks the owner to approve a bonus, which offers the job again once', async () => {
    const bethel = userOf(660501, 'Bethel');
    await paidOrder(shop.shopId, shop.size42, bethel);
    const offerId = offerIdFor(abebe.id);
    script.push(
      calls(['propose_bonus', { offerId, bonus: '30.00', reason: 'Nobody took it in 10 minutes' }]),
      done,
    );

    await fire(OFFER_UNANSWERED_TIMER, offerId);

    expect(lastTo(owner)?.text).toContain('Add a driver bonus?');
    expect(lastTo(owner)?.text).toContain('Bonus (birr): 30.00');
    const approve = approvalButton(owner, 'approve');
    await bot.handleUpdate(tap(ownerUser, approve));
    await bot.handleUpdate(tap(ownerUser, approve));

    expect(answers().slice(-2)).toEqual(['Approved and done.', 'This was already decided.']);
    expect(lastTo(abebe.id)?.text).toContain('155.00 ብር (bonus included)');
    expect(sentTo(abebe.id).filter((m) => m.text?.includes('bonus included'))).toHaveLength(1);
    await bot.handleUpdate(tap(abebe, `job:accept:${offerIdFor(abebe.id)}`));
    expect(answers().at(-1)).toBe('The job is yours.');
  });
});

describe('a customer who taps Problem after delivery', () => {
  async function deliveredOrder(customer: ReturnType<typeof userOf>): Promise<string> {
    const orderId = await paidOrder(shop.shopId, shop.size42, customer);
    await onTheWay(abebe);
    await deliver(abebe);
    await bot.handleUpdate(tap(customer, `receipt:problem:${orderId}`));
    return orderId;
  }

  it('gets a size exchange when the wanted size is in stock', async () => {
    const meron = userOf(660601, 'Meron');
    const orderId = await deliveredOrder(meron);
    expect(buttonsOf(lastTo(meron.id))).toEqual([
      `problem:wrong_size:${orderId}`,
      `problem:damaged:${orderId}`,
      `problem:other:${orderId}`,
    ]);
    await bot.handleUpdate(tap(meron, `problem:wrong_size:${orderId}`));
    expect(buttonsOf(lastTo(meron.id))).toEqual([`xsize:${orderId}:43`]);
    script.push(
      calls(['start_exchange', { orderId, fromVariantId: shop.size42, toVariantId: shop.size43 }]),
      done,
    );

    await bot.handleUpdate(tap(meron, `xsize:${orderId}:43`));

    expect(JSON.stringify(model.requests.at(-2)?.contents)).toContain(
      'Size the customer wants: 43',
    );
    expect(lastTo(meron.id)?.text).toContain('Size 43 is reserved for your exchange');
    expect(lastTo(owner)?.text).toContain('Size exchange for');
    const [variant] = await shopRows((tx) =>
      tx.select().from(productVariants).where(eq(productVariants.id, shop.size43)),
    );
    expect(variant).toMatchObject({ stock: 2, reserved: 1 });
    expect(await shopRows((tx) => tx.select().from(orderExchanges))).toMatchObject([
      { orderId, fromVariantId: shop.size42, toVariantId: shop.size43 },
    ]);
    const [decision] = (await decisionsOf(shop.shopId)).filter((d) => d.tool === 'start_exchange');
    expect(decision).toBeUndefined();

    await bot.handleUpdate(tap(meron, `xsize:${orderId}:43`));
    expect(answers().at(-1)).toBe('This button no longer works.');
  });

  it('gets a refund proposal for the owner when the size is sold out', async () => {
    const abel = userOf(660602, 'Abel');
    const orderId = await deliveredOrder(abel);
    await bot.handleUpdate(tap(abel, `problem:wrong_size:${orderId}`));
    script.push(
      calls(['start_exchange', { orderId, fromVariantId: shop.size42, toVariantId: shop.size43 }]),
      calls(['propose_refund', { orderId, amount: '3500.00', reason: 'Size 43 is sold out' }]),
      done,
    );
    // The last free pair of size 43 sells to someone else meanwhile.
    await shopRows((tx) =>
      tx
        .update(productVariants)
        .set({ stock: sql`${productVariants.reserved}` })
        .where(eq(productVariants.id, shop.size43)),
    );

    await bot.handleUpdate(tap(abel, `xsize:${orderId}:43`));

    const exchange = model.requests.at(-2)?.contents.at(-1);
    expect(JSON.stringify(exchange)).toContain('out of stock');
    expect(lastTo(owner)?.text).toContain('Refund the customer?');
    expect(lastTo(owner)?.text).toContain('Amount (birr): 3500.00');
    await bot.handleUpdate(tap(ownerUser, approvalButton(owner, 'approve')));
    expect(lastTo(abel.id)?.text).toContain('The shop approved a refund of 3,500.00 ብር');
  });

  it('goes straight to the owner while the owner answers the customer', async () => {
    const tigist = userOf(660604, 'Tigist');
    await services.conversations.requestHuman(
      shop.shopId,
      { telegramUserId: tigist.id, name: 'Tigist' },
      'Asked for the owner',
    );
    const requests = model.requests.length;

    const orderId = await deliveredOrder(tigist);

    expect(lastTo(owner)?.text).toContain('Reports a problem with delivered order');
    expect(buttonsOf(lastTo(tigist.id))).not.toContain(`problem:damaged:${orderId}`);
    expect(model.requests).toHaveLength(requests);
  });

  it('asks for a photo of damage and sends the case to the owner', async () => {
    const yonas = userOf(660603, 'Yonas');
    const orderId = await deliveredOrder(yonas);
    script.push(
      calls(
        ['message_customer', { orderId, text: 'Sorry! Please send a photo of the damage.' }],
        [
          'escalate',
          { orderId, summary: 'Shoe arrived damaged', recommendation: 'Replace the pair' },
        ],
      ),
      done,
    );

    await bot.handleUpdate(tap(yonas, `problem:damaged:${orderId}`));

    expect(lastTo(yonas.id)?.text).toBe('Sorry! Please send a photo of the damage.');
    expect(lastTo(owner)?.text).toContain('Take over this case?');
    expect(lastTo(owner)?.text).toContain('Buchi recommends: Replace the pair');
    await bot.handleUpdate(tap(ownerUser, approvalButton(owner, 'approve')));
    const [conversation] = await shopRows((tx) =>
      tx.select().from(conversations).where(eq(conversations.customerTelegramUserId, yonas.id)),
    );
    expect(conversation?.mode).toBe('human');
  });
});
