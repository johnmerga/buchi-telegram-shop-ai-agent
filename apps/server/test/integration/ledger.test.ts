import { productInputSchema } from '@buchi/shared';
import { eq } from 'drizzle-orm';
import { pino } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connectDatabase } from '../../src/db/client';
import { ledgerRows } from '../../src/db/schema';
import { withShop } from '../../src/db/with-shop';
import { CatalogRepo } from '../../src/modules/catalog/catalog.repo';
import { CatalogService } from '../../src/modules/catalog/catalog.service';
import { CustomersRepo } from '../../src/modules/customers/customers.repo';
import { CustomersService } from '../../src/modules/customers/customers.service';
import { SessionsRepo } from '../../src/modules/customers/sessions.repo';
import { TimersRepo } from '../../src/modules/jobs/timers.repo';
import { TimerService } from '../../src/modules/jobs/timers.service';
import { OrdersRepo } from '../../src/modules/orders/orders.repo';
import { OrderService } from '../../src/modules/orders/orders.service';
import { PaymentProofsRepo } from '../../src/modules/payments/payment-proofs.repo';
import { PaymentRecords } from '../../src/modules/payments/payment-records.service';
import { RiskSignalsRepo } from '../../src/modules/payments/risk-signals.repo';
import { RiskService } from '../../src/modules/payments/risk.service';
import {
  ledgerHeaders,
  type LedgerCell,
  type LedgerRow,
  type LedgerTab,
} from '../../src/modules/reports/ledger.domain';
import { LedgerRepo } from '../../src/modules/reports/ledger.repo';
import { LedgerService, type LedgerSheets } from '../../src/modules/reports/ledger.service';
import { SalesLedger } from '../../src/modules/reports/sales-ledger.service';
import { NegotiationsRepo } from '../../src/modules/sales/negotiations.repo';
import { NegotiationService } from '../../src/modules/sales/negotiation.service';
import { ShopsRepo } from '../../src/modules/shops/shops.repo';
import { ShopsService } from '../../src/modules/shops/shops.service';
import { EventBus } from '../../src/shared/events';
import { noEmbeddings } from '../fakes/no-embeddings';
import { testDatabaseUrl } from './test-database';

const { db, close } = connectDatabase(testDatabaseUrl);
afterAll(close);

const logger = pino({ level: 'silent' });
const MINUTE = 60_000;

/** A spreadsheet in memory that can be down, or apply an append and then lose the answer. */
class FakeSheets implements LedgerSheets {
  readonly tabs = new Map<string, LedgerCell[][]>();
  down = false;
  loseAnswers = false;
  appends = 0;

  firstColumn(spreadsheetId: string, tab: LedgerTab): Promise<Set<string>> {
    if (this.down) return Promise.reject(new Error('Google Sheets answered 503'));
    return Promise.resolve(new Set(this.rows(spreadsheetId, tab).map((row) => String(row[0]))));
  }

  append(spreadsheetId: string, tab: LedgerTab, rows: LedgerCell[][]): Promise<void> {
    if (this.down) return Promise.reject(new Error('Google Sheets answered 503'));
    this.appends += 1;
    this.tabs.set(`${spreadsheetId}/${tab}`, [...this.rows(spreadsheetId, tab), ...rows]);
    return this.loseAnswers
      ? Promise.reject(new Error('The operation timed out'))
      : Promise.resolve();
  }

  rows(spreadsheetId: string, tab: LedgerTab): LedgerCell[][] {
    return this.tabs.get(`${spreadsheetId}/${tab}`) ?? [];
  }
}

const spreadsheetId = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';
let now = Date.now();
const clock = () => new Date(now);
const sheets = new FakeSheets();
const ledgerRepo = new LedgerRepo();
const ledger = new LedgerService(
  db,
  ledgerRepo,
  { sheets, serviceAccountEmail: 'ledger@buchi.iam.gserviceaccount.com' },
  logger,
  clock,
);

const shops = new ShopsService(db, new ShopsRepo(db), {
  verifyPostingRights: () => Promise.reject(new Error('unused')),
});
let shopId = '';

const row = (key: string): LedgerRow => ({ key, tab: 'Sales', cells: [key, 'Nike Air', 3500] });

async function queued(): Promise<(typeof ledgerRows.$inferSelect)[]> {
  return db.select().from(ledgerRows).where(eq(ledgerRows.shopId, shopId));
}

beforeAll(async () => {
  shopId = await shops.create(770001, { name: 'Selam Shoes' });
});

beforeEach(async () => {
  await db.delete(ledgerRows).where(eq(ledgerRows.shopId, shopId));
  sheets.tabs.clear();
  sheets.down = false;
  sheets.loseAnswers = false;
  sheets.appends = 0;
  await ledger.connect(shopId, spreadsheetId);
});

describe('ledger queue', () => {
  it('queues nothing for a shop that keeps no spreadsheet', async () => {
    await ledger.connect(shopId, null);
    await ledger.enqueue(shopId, row('sale-a'));
    expect(await queued()).toEqual([]);
  });

  it('queues a key once, so a replayed event adds no second row', async () => {
    await ledger.enqueue(shopId, row('sale-a'));
    await ledger.enqueue(shopId, row('sale-a'));
    expect(await queued()).toHaveLength(1);
  });

  it('sends due rows with a header to an empty tab', async () => {
    await ledger.enqueue(shopId, row('sale-a'));
    await ledger.enqueue(shopId, row('sale-b'));
    expect(await ledger.flush()).toEqual({ ledgerSent: 2, ledgerFailed: 0 });
    expect(sheets.rows(spreadsheetId, 'Sales')).toEqual([
      ledgerHeaders.Sales,
      ['sale-a', 'Nike Air', 3500],
      ['sale-b', 'Nike Air', 3500],
    ]);
    expect((await queued()).every((r) => r.status === 'sent')).toBe(true);
    expect(await ledger.flush()).toEqual({ ledgerSent: 0, ledgerFailed: 0 });
  });

  it('keeps rows while Sheets is down, backs off, and sends them once it is back', async () => {
    await ledger.enqueue(shopId, row('sale-a'));
    sheets.down = true;
    expect(await ledger.flush()).toEqual({ ledgerSent: 0, ledgerFailed: 1 });
    const [failed] = await queued();
    expect(failed).toMatchObject({ status: 'pending', attempts: 1 });
    expect(failed?.lastError).toBe('Google Sheets answered 503');
    expect(failed?.nextAttemptAt.getTime()).toBe(now + MINUTE);

    sheets.down = false;
    expect(await ledger.flush()).toEqual({ ledgerSent: 0, ledgerFailed: 0 });
    now += MINUTE;
    expect(await ledger.flush()).toEqual({ ledgerSent: 1, ledgerFailed: 0 });
    expect(sheets.rows(spreadsheetId, 'Sales')).toHaveLength(2);
    const settings = await ledger.settings(shopId);
    expect(settings).toMatchObject({ pending: 0, lastError: null });
  });

  it('doubles the wait after each failure', async () => {
    await ledger.enqueue(shopId, row('sale-a'));
    sheets.down = true;
    await ledger.flush();
    now += MINUTE;
    await ledger.flush();
    const [failed] = await queued();
    expect(failed?.attempts).toBe(2);
    expect(failed?.nextAttemptAt.getTime()).toBe(now + 2 * MINUTE);
  });

  it('never appends a row twice when an append arrived but its answer was lost', async () => {
    await ledger.enqueue(shopId, row('sale-a'));
    sheets.loseAnswers = true;
    expect(await ledger.flush()).toEqual({ ledgerSent: 0, ledgerFailed: 1 });
    expect((await queued())[0]?.status).toBe('pending');

    sheets.loseAnswers = false;
    now += MINUTE;
    expect(await ledger.flush()).toEqual({ ledgerSent: 1, ledgerFailed: 0 });
    expect(sheets.appends).toBe(1);
    expect(sheets.rows(spreadsheetId, 'Sales').filter((r) => r[0] === 'sale-a')).toHaveLength(1);
  });

  it('retries a row whose attempt crashed once the two-minute lease ends', async () => {
    await ledger.enqueue(shopId, row('sale-a'));
    await withShop(db, shopId, (tx) =>
      ledgerRepo.claimDue(tx, clock(), new Date(now + 2 * MINUTE), 50),
    );
    expect(await ledger.flush()).toEqual({ ledgerSent: 0, ledgerFailed: 0 });
    now += 2 * MINUTE;
    expect(await ledger.flush()).toEqual({ ledgerSent: 1, ledgerFailed: 0 });
  });

  it('keeps every row queued when the server has no Google credentials', async () => {
    const disabled = new LedgerService(db, ledgerRepo, undefined, logger, clock);
    await disabled.enqueue(shopId, row('sale-a'));
    expect(await disabled.flush()).toEqual({ ledgerSent: 0, ledgerFailed: 0 });
    expect(await disabled.settings(shopId)).toMatchObject({
      spreadsheetId,
      serviceAccountEmail: null,
      pending: 1,
    });
  });
});

describe('sales ledger', () => {
  const events = new EventBus(logger);
  const customers = new CustomersService(db, new CustomersRepo(), new SessionsRepo(db));
  const orders = new OrderService(
    db,
    new OrdersRepo(),
    events,
    new TimerService(new TimersRepo(db), logger),
    new NegotiationService(db, new NegotiationsRepo()),
  );
  const proofs = new PaymentProofsRepo();
  const records = new PaymentRecords(
    db,
    proofs,
    orders,
    customers,
    new RiskService(new RiskSignalsRepo(db), 'r'.repeat(32)),
  );
  const sales = new SalesLedger(orders, records, ledger, clock);
  events.subscribe('order.transitioned', (event) => sales.orderTransitioned(event));
  const catalog = new CatalogService(
    db,
    new CatalogRepo(),
    shops,
    { publish: () => Promise.reject(new Error('unused')) },
    'buchi_test_bot',
    noEmbeddings,
  );

  it('queues a row when a payment is approved, with the bank check and the items', async () => {
    const product = await catalog.createProduct(
      shopId,
      productInputSchema.parse({ title: 'Nike Air', pricingMode: 'fixed', price: '3500' }),
    );
    await catalog.setVariants(shopId, product.id, [{ size: '42', color: null, stock: 5 }]);
    const variantId = (await catalog.listProducts(shopId))[0]?.variants[0]?.id ?? '';
    const customer = await customers.identify(shopId, 770101, 'Hana');
    const order = await orders.create(
      shopId,
      {
        customerId: customer.id,
        items: [{ variantId, quantity: 1 }],
        delivery: { type: 'pickup' },
        paymentDeadline: new Date(now + 60 * MINUTE),
      },
      'customer',
    );
    await orders.transition(shopId, order.id, 'payment_submitted', 'customer', 'Screenshot');
    await withShop(db, shopId, (tx) =>
      proofs.insert(tx, {
        shopId,
        orderId: order.id,
        telegramFileId: 'file-1',
        provider: 'cbe_bank',
        txRef: 'FT26309ABCDE',
        amount: '3500.00',
        bankCheck: 'CONFIRMED',
        decision: 'approve',
      }),
    );
    await orders.transition(shopId, order.id, 'payment_approved', 'system', 'Paid');

    const [sale] = await queued();
    expect(sale?.key).toBe(`sale-${order.id}`);
    expect(sale?.cells.slice(2)).toEqual([
      `#${order.id.slice(0, 6).toUpperCase()}`,
      '1 × Nike Air (42)',
      0,
      3500,
      'cbe_bank',
      'FT26309ABCDE',
      'yes',
    ]);
  });
});
