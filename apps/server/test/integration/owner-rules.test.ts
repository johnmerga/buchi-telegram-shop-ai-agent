import { productInputSchema } from '@buchi/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connectDatabase } from '../../src/db/client';
import { agentDecisions, ownerRules } from '../../src/db/schema';
import { withShop } from '../../src/db/with-shop';
import { buttonsOf, calls, tap, text, userOf } from '../fakes/operations-fixtures';
import { createOwnerBot, type Clock } from '../fakes/owner-bot';
import { ScriptedModel, type ScriptedTurn } from '../fakes/scripted-model';
import { testDatabaseUrl } from './test-database';

const { db, close } = connectDatabase(testDatabaseUrl);
afterAll(close);

/** Thursday 5 November 2026, 17:00 in Addis Ababa. */
const clock: Clock = { now: new Date('2026-11-05T14:00:00Z') };
const script: ScriptedTurn[] = [];
const { bot, sent, services } = createOwnerBot(db, new ScriptedModel(script), clock);
const { shops, catalog, customers, orders, delivery } = services;

const owner = userOf(970001, 'Selam');
const buyer = userOf(970101, 'Hana');
let shopId = '';
let sneakerSize42 = '';
let bootsSize40 = '';

const settings = {
  baseFee: '50',
  ratePerKm: '18',
  ratePerMinute: '2',
  freeRadiusKm: 3,
  standardRangeKm: 8,
  farRangeKm: 20,
  farCap: '1000',
  saverDiscountPercent: 20,
};

const sentTo = (chatId: number) => sent.filter((m) => m.chatId === chatId && m.text);
const lastPreview = () => sentTo(owner.id).findLast((m) => buttonsOf(m).length > 0);
const confirmData = () => buttonsOf(lastPreview())[0] ?? '';
const rulesOf = () => withShop(db, shopId, (tx) => tx.select().from(ownerRules));

/** The owner writes a command; the model proposes the rule and replies. */
async function command(words: string, rule: Record<string, unknown>) {
  script.push(calls(['propose_rule', rule]), { text: 'I prepared a preview. Tap Confirm.' });
  await bot.handleUpdate(text(owner, words));
}

beforeAll(async () => {
  shopId = await shops.create(owner.id, { name: 'Selam Shoes' });
  await shops.setLocation(shopId, { latitude: 9.0108, longitude: 38.7613 });
  await delivery.saveSettings(shopId, settings);
  const sneaker = await catalog.createProduct(
    shopId,
    productInputSchema.parse({ title: 'Nike Air sneaker', pricingMode: 'fixed', price: '3499' }),
  );
  await catalog.setVariants(shopId, sneaker.id, [{ size: '42', color: null, stock: 5 }]);
  const boots = await catalog.createProduct(
    shopId,
    productInputSchema.parse({
      title: 'Leather boots sneaker',
      pricingMode: 'negotiable',
      price: '4000',
      lowestPrice: '3500',
    }),
  );
  await catalog.setVariants(shopId, boots.id, [{ size: '40', color: null, stock: 5 }]);
  const variants = await catalog.listProducts(shopId);
  sneakerSize42 = variants.find((p) => p.id === sneaker.id)?.variants[0]?.id ?? '';
  bootsSize40 = variants.find((p) => p.id === boots.id)?.variants[0]?.id ?? '';
});

beforeEach(() => {
  expect(script).toEqual([]);
  clock.now = new Date('2026-11-05T14:00:00Z');
});

describe('a delivery pause', () => {
  it('"ነገ ከ10 ሰዓት በኋላ ዴሊቨሪ የለም" waits for Confirm, then checkout is pickup only from 4 PM', async () => {
    await command('ነገ ከ10 ሰዓት በኋላ ዴሊቨሪ የለም', {
      type: 'delivery_pause',
      deliveryPause: { date: '2026-11-06', from: { clock: 'ethiopian', hour: 10 } },
    });

    const preview = lastPreview();
    expect(preview?.text).toContain('From: Fri 6 Nov, 16:00 (ከቀኑ 10 ሰዓት)');
    expect(JSON.stringify(preview?.payload.reply_markup)).toContain('Confirm');
    expect(sentTo(owner.id).at(-1)?.text).toBe('I prepared a preview. Tap Confirm.');
    expect(await rulesOf()).toEqual([]);

    await bot.handleUpdate(tap(owner, confirmData()));
    expect(await rulesOf()).toMatchObject([
      {
        type: 'delivery_pause',
        startsAt: new Date('2026-11-06T13:00:00Z'),
        endsAt: new Date('2026-11-06T21:00:00Z'),
        confirmedBy: owner.id,
      },
    ]);

    clock.now = new Date('2026-11-06T12:59:00Z');
    expect(await delivery.offersDelivery(shopId)).toBe(true);
    clock.now = new Date('2026-11-06T13:00:00Z');
    expect(await delivery.offersDelivery(shopId)).toBe(false);
    expect(await delivery.quote(shopId, { latitude: 9.02, longitude: 38.8 })).toBeUndefined();
    clock.now = new Date('2026-11-06T21:00:00Z');
    expect(await delivery.offersDelivery(shopId)).toBe(true);
  });

  it('is not saved when the owner taps Cancel', async () => {
    const before = (await rulesOf()).length;
    await command('No deliveries on Sunday', {
      type: 'delivery_pause',
      deliveryPause: { date: '2026-11-08' },
    });
    const cancel = buttonsOf(lastPreview())[1] ?? '';
    await bot.handleUpdate(tap(owner, cancel));
    expect(await rulesOf()).toHaveLength(before);
  });
});

describe('a promotion', () => {
  it('takes 10% off matching fixed prices only during its days, and never a negotiable price', async () => {
    await command('All sneakers 10% off this weekend', {
      type: 'promotion',
      promotion: {
        percentOff: 10,
        keywords: ['sneaker'],
        startDate: '2026-11-07',
        endDate: '2026-11-08',
      },
    });
    expect(lastPreview()?.text).toContain('Matches now: 1 (Nike Air sneaker)');
    await bot.handleUpdate(tap(owner, confirmData()));

    const customer = await customers.identify(shopId, buyer.id, 'Hana');
    const priceOn = async (instant: string, variantId: string) => {
      clock.now = new Date(instant);
      return (await orders.unitPrice(shopId, customer.id, variantId))?.toString();
    };
    expect(await priceOn('2026-11-06T20:59:00Z', sneakerSize42)).toBe('3499.00');
    expect(await priceOn('2026-11-07T09:00:00Z', sneakerSize42)).toBe('3149.00');
    expect(await priceOn('2026-11-07T09:00:00Z', bootsSize40)).toBeUndefined();
    expect(await priceOn('2026-11-08T21:00:00Z', sneakerSize42)).toBe('3499.00');

    clock.now = new Date('2026-11-07T09:00:00Z');
    const order = await orders.create(
      shopId,
      {
        customerId: customer.id,
        items: [{ variantId: sneakerSize42, quantity: 1 }],
        delivery: { type: 'pickup' },
        paymentDeadline: new Date('2026-11-07T12:00:00Z'),
      },
      'customer',
    );
    expect(order.total).toBe('3149.00');
  });
});

describe('a delivery settings change', () => {
  it('shows the old and new values, and saves them once confirmed', async () => {
    await command('Make it 22 birr per km', {
      type: 'delivery_settings',
      deliverySettings: { ratePerKm: '22' },
    });
    expect(lastPreview()?.text).toContain('Rate per km: 18.00 ብር → 22.00 ብር');
    await bot.handleUpdate(tap(owner, confirmData()));
    expect((await delivery.savedSettings(shopId)).settings?.ratePerKm).toBe('22.00');
  });

  it('refuses settings that do not fit together, and saves nothing', async () => {
    await command('Free delivery up to 10 km', {
      type: 'delivery_settings',
      deliverySettings: { freeRadiusKm: 10 },
    });
    const before = (await rulesOf()).length;
    await bot.handleUpdate(tap(owner, confirmData()));
    expect(sentTo(owner.id).at(-1)?.text).toContain('do not fit together');
    expect(await rulesOf()).toHaveLength(before);
    expect((await delivery.savedSettings(shopId)).settings?.freeRadiusKm).toBe(3);
  });
});

describe('the owner assistant', () => {
  it('is not reachable for a customer, whose words go to the sales agent', async () => {
    const stranger = userOf(970202, 'Abel');
    await customers.identify(shopId, stranger.id, 'Abel');
    await customers.startSession(stranger.id, shopId, null);
    await bot.handleUpdate(text(stranger, 'Pause deliveries tomorrow'));
    expect(sentTo(stranger.id).at(-1)?.text).toBe('sales agent answered');
    const held = await withShop(db, shopId, (tx) =>
      tx.select().from(agentDecisions).where(eq(agentDecisions.ownerStatus, 'pending')),
    );
    expect(held).toEqual([]);
  });
});
