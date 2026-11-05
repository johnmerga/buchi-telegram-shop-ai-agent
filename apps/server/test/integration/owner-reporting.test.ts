import { productInputSchema } from '@buchi/shared';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connectDatabase, type Transaction } from '../../src/db/client';
import { agentDecisions, agentTraces, deliveryJobs, drivers, jobStops } from '../../src/db/schema';
import { withReportReader } from '../../src/db/with-report-reader';
import { withShop } from '../../src/db/with-shop';
import { ReportingRepo } from '../../src/modules/reporting/reporting.repo';
import { ReportingService } from '../../src/modules/reporting/reporting.service';
import { AppError } from '../../src/shared/errors';
import { buttonsOf, calls, text, userOf } from '../fakes/operations-fixtures';
import { createOwnerBot, type Clock } from '../fakes/owner-bot';
import { ScriptedModel, type ScriptedTurn } from '../fakes/scripted-model';
import { testDatabaseUrl } from './test-database';

const { db, close } = connectDatabase(testDatabaseUrl);
afterAll(close);

const clock: Clock = { now: new Date() };
const script: ScriptedTurn[] = [];
const model = new ScriptedModel(script);
const { bot, sent, charts, chartOutage, services } = createOwnerBot(db, model, clock);
const { shops, catalog, customers, orders, delivery, reporting, weekly } = services;

const owner = userOf(890001, 'Selam');
const otherOwner = userOf(890002, 'Mulu');
let shopId = '';
let otherShopId = '';

/** A paid pickup order of `quantity` units, in the shop's own transactions. */
async function paidOrder(shop: string, variantId: string, quantity: number, buyerId: number) {
  const customer = await customers.identify(shop, buyerId, 'Buyer');
  const order = await orders.create(
    shop,
    {
      customerId: customer.id,
      items: [{ variantId, quantity }],
      delivery: { type: 'pickup' },
      paymentDeadline: new Date(Date.now() + 3_600_000),
    },
    'customer',
  );
  await orders.transition(shop, order.id, 'payment_submitted', 'customer', 'Sent a receipt');
  await orders.transition(shop, order.id, 'payment_approved', 'system', 'Verified');
  return order;
}

async function product(shop: string, title: string, price: string, stock: number) {
  const row = await catalog.createProduct(
    shop,
    productInputSchema.parse({ title, pricingMode: 'fixed', price }),
  );
  await catalog.setVariants(shop, row.id, [{ size: '42', color: null, stock }]);
  const [listed] = await catalog.activeProducts(shop, [row.id]);
  return listed?.variants[0]?.id ?? '';
}

/** A delivered 12 km trip that cost 160 birr and earned 100 in fees. */
async function farTrip(shop: string, orderId: string) {
  await withShop(db, shop, async (tx: Transaction) => {
    const [driver] = await tx
      .insert(drivers)
      .values({ shopId: shop, username: `driver_${shop.slice(0, 6)}` })
      .returning();
    const [job] = await tx
      .insert(deliveryJobs)
      .values({
        shopId: shop,
        driverId: driver?.id ?? null,
        status: 'delivered',
        payout: '160',
        separateTripsPayout: '160',
        routeMeters: 12_000,
        estimatedMinutes: 30,
        actualMinutes: 35,
        deliveredAt: new Date(),
      })
      .returning();
    await tx.insert(jobStops).values({ shopId: shop, jobId: job?.id ?? '', orderId, position: 1 });
    await tx.execute(
      sql`update orders set delivery_fee = 100, total = items_total + 100 where id = ${orderId}`,
    );
  });
}

beforeAll(async () => {
  shopId = await shops.create(owner.id, { name: 'Selam Shoes' });
  otherShopId = await shops.create(otherOwner.id, { name: 'Mulu Boutique' });
  const nike = await product(shopId, 'Nike Air', '3500', 20);
  const samba = await product(shopId, 'Adidas Samba', '3200', 20);
  const dress = await product(otherShopId, 'Red dress', '1500', 20);
  await paidOrder(shopId, nike, 3, 890101);
  const samba1 = await paidOrder(shopId, samba, 1, 890102);
  await paidOrder(otherShopId, dress, 9, 890103);
  await farTrip(shopId, samba1.id);
  await delivery.saveSettings(shopId, {
    baseFee: '50',
    ratePerKm: '18',
    ratePerMinute: '2',
    freeRadiusKm: 3,
    standardRangeKm: 8,
    farRangeKm: 20,
    farCap: '1000',
    saverDiscountPercent: 20,
  });
});

beforeEach(() => {
  expect(script).toEqual([]);
});

const bestSellers =
  'select product_title, sum(quantity) as units from report_sales group by product_title order by units desc';

describe('ask_data', () => {
  it("answers from the shop's own rows only", async () => {
    const result = await reporting.ask(shopId, bestSellers);
    expect(result).toEqual({
      columns: ['product_title', 'units'],
      rows: [
        { product_title: 'Nike Air', units: '3' },
        { product_title: 'Adidas Samba', units: '1' },
      ],
    });
    const other = await reporting.ask(otherShopId, bestSellers);
    expect(other.rows).toEqual([{ product_title: 'Red dress', units: '9' }]);
  });

  it.each([
    ['an UPDATE', 'update orders set total = 0'],
    ['two statements', 'select 1 from report_orders; delete from report_orders'],
    ['a table outside the allowlist', 'select phone from customers'],
    ['a CTE over a table', 'with c as (select * from customers) select * from c'],
    ['a system catalog', 'select * from pg_catalog.pg_roles'],
    ['a function outside the allowlist', 'select pg_sleep(5) from report_orders'],
  ])('rejects %s before it reaches the database', async (_case, query) => {
    let reached = 0;
    class CountingRepo extends ReportingRepo {
      override checkedQuery(tx: Transaction, checkedSql: string) {
        reached += 1;
        return super.checkedQuery(tx, checkedSql);
      }
    }
    const counted = new ReportingService(db, new CountingRepo(db), () => clock.now);
    await expect(counted.ask(shopId, query)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(reached).toBe(0);
  });

  it('turns a query mistake into an error the model can fix', async () => {
    await expect(reporting.ask(shopId, 'select no_such_column from report_sales')).rejects.toThrow(
      'column "no_such_column" does not exist',
    );
  });
});

describe('the report reader', () => {
  const asReader = (query: string) =>
    withReportReader(db, shopId, (tx) => tx.execute(sql.raw(query)));

  it('cannot read the tables behind the views, even if a query got past the checks', async () => {
    await expect(asReader('select phone from customers')).rejects.toMatchObject({
      cause: { code: '42501' },
    });
  });

  it('cannot write, runs read-only, and stops a query after three seconds', async () => {
    await expect(asReader("delete from report_orders where status = 'paid'")).rejects.toMatchObject(
      {
        cause: { code: '42501' },
      },
    );
    const [mode] = await asReader('show transaction_read_only');
    expect(mode).toEqual({ transaction_read_only: 'on' });
    await expect(asReader('select pg_sleep(4)')).rejects.toMatchObject({
      cause: { code: '57014' },
    });
  }, 10_000);
});

describe("the owner's questions", () => {
  it('get the answer with a chart of the series', async () => {
    script.push(calls(['ask_data', { sql: bestSellers, title: 'Best sellers' }]), {
      text: 'Nike Air sold most: 3 pairs.',
    });
    await bot.handleUpdate(text(owner, 'ባለፈው ሳምንት የትኛው ምርት በብዛት ተሸጠ?'));

    expect(sent.findLast((m) => m.chatId === owner.id && m.method === 'sendMessage')?.text).toBe(
      'Nike Air sold most: 3 pairs.',
    );
    expect(sent.at(-1)?.method).toBe('sendPhoto');
    expect(charts.at(-1)).toMatchObject({
      type: 'bar',
      data: { labels: ['Nike Air', 'Adidas Samba'], datasets: [{ label: 'units', data: [3, 1] }] },
    });
  });

  it('get the rows instead of a reply with a figure no query returned', async () => {
    script.push(calls(['ask_data', { sql: bestSellers, title: 'Best sellers' }]), {
      text: 'Revenue was 99,999 birr.',
    });
    await bot.handleUpdate(text(owner, 'How did we do?'));
    const reply = sent.findLast((m) => m.chatId === owner.id && m.method === 'sendMessage');
    expect(reply?.text).toContain('Best sellers\nproduct_title · units\nNike Air · 3');
  });

  it('get the numbers as text when QuickChart is down', async () => {
    chartOutage.active = true;
    script.push(calls(['ask_data', { sql: bestSellers, title: 'Best sellers' }]), {
      text: 'Nike Air sold most: 3 pairs.',
    });
    const before = sent.length;
    try {
      await bot.handleUpdate(text(owner, 'Which product sold most?'));
    } finally {
      chartOutage.active = false;
    }

    const replies = sent.slice(before).filter((m) => m.chatId === owner.id);
    expect(replies.map((m) => m.method)).toEqual(['sendMessage']);
    expect(replies[0]?.text).toBe('Nike Air sold most: 3 pairs.');
  });

  it('get an apology, not a guess, when Gemini has no quota left', async () => {
    script.push({ error: new AppError('QUOTA_EXHAUSTED', 'No Gemini quota left') });
    await bot.handleUpdate(text(owner, 'How many pairs did we sell?'));
    expect(sent.findLast((m) => m.chatId === owner.id)?.text).toContain('cannot answer right now');
  });

  it('send a refused query back to the model as an error', async () => {
    script.push(calls(['ask_data', { sql: 'select phone from customers', title: 'Phones' }]), {
      text: 'I can only read the reporting views.',
    });
    await bot.handleUpdate(text(owner, 'List customer phone numbers'));
    expect(JSON.stringify(model.requests.at(-1)?.contents)).toContain('not a reporting view');
  });
});

describe('weekly suggestions', () => {
  it('send only suggestions whose numbers came from the analysis, each as a rule preview', async () => {
    // Other test files' shops have orders too; only this shop's week is left to run.
    for (const other of await reporting.shopsForWeeklySuggestions()) {
      if (other !== shopId) await reporting.claimWeek(other);
    }
    script.push(calls(['weekly_analysis', {}]), {
      text: JSON.stringify({
        suggestions: [
          {
            text: 'Trips of over 10 km lost 60.00 birr on average.',
            rule: { type: 'delivery_settings', deliverySettings: { ratePerKm: '22' } },
          },
          {
            text: 'Samba sizes sell 40% slower than last month.',
            rule: {
              type: 'promotion',
              promotion: {
                percentOff: 10,
                keywords: ['samba'],
                startDate: '2026-11-10',
                endDate: '2026-11-16',
              },
            },
          },
        ],
      }),
    });

    expect(await weekly.run()).toMatchObject({ suggestions: 1, dropped: 1 });

    const toOwner = sent.filter((m) => m.chatId === owner.id && m.method === 'sendMessage');
    const [list, preview] = toOwner.slice(-2);
    expect(list?.text).toContain('1. Trips of over 10 km lost 60.00 birr on average.');
    expect(list?.text).not.toContain('Samba');
    expect(preview?.text).toContain('Rate per km: 18.00 ብር → 22.00 ብር');
    expect(buttonsOf(preview)).toHaveLength(2);

    const traces = await withShop(db, shopId, (tx) => tx.select().from(agentTraces));
    const weeklyRun = traces.filter((trace) => trace.promptId === 'weekly-suggestions');
    expect(weeklyRun.flatMap((trace) => trace.toolCalls.map((call) => call.name))).toEqual([
      'weekly_analysis',
    ]);
    const held = await withShop(db, shopId, (tx) => tx.select().from(agentDecisions));
    expect(held.filter((d) => d.runId === weeklyRun[0]?.runId).map((d) => d.tool)).toEqual([
      'propose_rule',
    ]);
  });

  it('run once a week, however often the job is called', async () => {
    expect(await weekly.run()).toEqual({ shops: 0, suggestions: 0, dropped: 0 });
  });
});
