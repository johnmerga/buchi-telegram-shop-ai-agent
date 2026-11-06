import { productInputSchema, type BankCheck } from '@buchi/shared';
import { Api } from 'grammy';
import type { Chat, Update, User } from 'grammy/types';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectDatabase } from '../../src/db/client';
import { CatalogRepo } from '../../src/modules/catalog/catalog.repo';
import { CatalogService } from '../../src/modules/catalog/catalog.service';
import { CustomersRepo } from '../../src/modules/customers/customers.repo';
import { CustomersService } from '../../src/modules/customers/customers.service';
import { SessionsRepo } from '../../src/modules/customers/sessions.repo';
import { TimersRepo } from '../../src/modules/jobs/timers.repo';
import { TimerService } from '../../src/modules/jobs/timers.service';
import { CheckoutService } from '../../src/modules/orders/checkout.service';
import { PAYMENT_HOLD_MS } from '../../src/modules/orders/orders.deadlines.domain';
import { OrdersRepo } from '../../src/modules/orders/orders.repo';
import { OrderService } from '../../src/modules/orders/orders.service';
import { createConversationHandlers } from '../../src/modules/owner/conversations.handlers';
import { ConversationsRepo } from '../../src/modules/owner/conversations.repo';
import { ConversationService } from '../../src/modules/owner/conversations.service';
import { OwnerNotifier } from '../../src/modules/owner/owner-notifier.service';
import { ImageIntake } from '../../src/modules/payments/image-intake.service';
import { PaymentNotifier } from '../../src/modules/payments/payment-notifier.service';
import { PaymentProofsRepo } from '../../src/modules/payments/payment-proofs.repo';
import { PaymentRefsRepo } from '../../src/modules/payments/payment-refs.repo';
import { PaymentRecords } from '../../src/modules/payments/payment-records.service';
import { PaymentReports } from '../../src/modules/payments/payment-reports.service';
import { PaymentReview } from '../../src/modules/payments/payment-review.service';
import { PaymentVerification } from '../../src/modules/payments/payment-verification.service';
import { createPaymentHandlers } from '../../src/modules/payments/payments.handlers';
import { ReceiptReader } from '../../src/modules/payments/receipt-reader.service';
import { RiskSignalsRepo } from '../../src/modules/payments/risk-signals.repo';
import { RiskService } from '../../src/modules/payments/risk.service';
import { ShopsRepo } from '../../src/modules/shops/shops.repo';
import { ShopsService } from '../../src/modules/shops/shops.service';
import { EventBus } from '../../src/shared/events';
import { createBot } from '../../src/telegram/bot';
import { TelegramMessenger } from '../../src/telegram/messenger';
import { ScriptedModel, type ScriptedTurn } from '../fakes/scripted-model';
import { pickupOnlyDelivery } from '../fakes/pickup-only-delivery';
import { AppError } from '../../src/shared/errors';
import { testDatabaseUrl } from './test-database';
import { noEmbeddings } from '../fakes/no-embeddings';
import { NegotiationService } from '../../src/modules/sales/negotiation.service';
import { NegotiationsRepo } from '../../src/modules/sales/negotiations.repo';
import { PhotoSearchService } from '../../src/modules/catalog/photo-search.service';
import { DemandRepo } from '../../src/modules/demand/demand.repo';
import { DemandService } from '../../src/modules/demand/demand.service';
import { TelegramCustomerChat } from '../../src/telegram/customer-chat';
import { StockHoldsRepo } from '../../src/modules/orders/stock-holds.repo';
import { noEvents } from '../fakes/no-events';
import { noPromotions } from '../fakes/no-owner-rules';

const { db, close } = connectDatabase(testDatabaseUrl);
afterAll(close);

const logger = pino({ level: 'silent' });
const botInfo = {
  id: 1,
  is_bot: true as const,
  first_name: 'Buchi',
  username: 'buchi_test_bot',
  can_join_groups: false,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
  has_topics_enabled: false,
  allows_users_to_create_topics: false,
  can_manage_bots: false,
  supports_join_request_queries: false,
};

const noChannels = {
  verifyPostingRights: () => Promise.reject(new Error('unused')),
  publish: () => Promise.reject(new Error('unused')),
};
const shops = new ShopsService(db, new ShopsRepo(db), noChannels);
const catalog = new CatalogService(
  db,
  new CatalogRepo(),
  shops,
  noChannels,
  botInfo.username,
  noEmbeddings,
  noEvents,
);
const customers = new CustomersService(db, new CustomersRepo(), new SessionsRepo(db));
const timers = new TimerService(new TimersRepo(db), logger);
const orders = new OrderService(
  db,
  new OrdersRepo(),
  new EventBus(logger),
  timers,
  new NegotiationService(db, new NegotiationsRepo()),
  noPromotions,
  new StockHoldsRepo(),
);
const checkout = new CheckoutService(
  customers,
  orders,
  shops,
  pickupOnlyDelivery,
  () => new Date(),
);

/** The model's answers, in order. Each test adds the turns it needs. */
const script: ScriptedTurn[] = [];
/** What the fake bank page says next. */
let bankSays: BankCheck = 'CONFIRMED';

interface Call {
  method: string;
  chatId: number | undefined;
  text: string | undefined;
  payload: Record<string, unknown>;
}
const calls: Call[] = [];
let nextMessageId = 5000;
const fakeTelegram = (api: Api) => {
  api.config.use((_prev, method, payload) => {
    const fields: Record<string, unknown> = { ...payload };
    const text = fields.text ?? fields.caption;
    calls.push({
      method,
      chatId: typeof fields.chat_id === 'number' ? fields.chat_id : undefined,
      text: typeof text === 'string' ? text : undefined,
      payload: fields,
    });
    const sends = ['sendMessage', 'copyMessage'];
    return Promise.resolve({
      ok: true,
      result: sends.includes(method) ? { message_id: nextMessageId++ } : true,
    } as never);
  });
};

const messengerApi = new Api('test');
fakeTelegram(messengerApi);
const messenger = new TelegramMessenger(messengerApi);
const conversationsRepo = new ConversationsRepo();
const conversations = new ConversationService(
  db,
  conversationsRepo,
  new OwnerNotifier(db, conversationsRepo, shops, messenger, logger),
  messenger,
  timers,
  () => new Date(),
);

const model = new ScriptedModel(script);
const reader = new ReceiptReader(model, logger);
const proofs = new PaymentProofsRepo();
const refs = new PaymentRefsRepo(db);
const risk = new RiskService(new RiskSignalsRepo(db), 'r'.repeat(32));
const paymentNotifier = new PaymentNotifier(shops, orders, messenger, logger);
const verification = new PaymentVerification(
  db,
  proofs,
  refs,
  reader,
  { check: () => Promise.resolve(bankSays) },
  risk,
  orders,
  shops,
  customers,
  paymentNotifier,
  () => new Date(),
);
const photoSearch = new PhotoSearchService(
  db,
  new CatalogRepo(),
  catalog,
  model,
  new DemandService(db, new DemandRepo(), new EventBus(logger)),
  logger,
);
const intake = new ImageIntake(
  { download: () => Promise.resolve('aW1hZ2U=') },
  reader,
  orders,
  verification,
  photoSearch,
  customers,
);
const chatApi = new Api('test');
fakeTelegram(chatApi);
const review = new PaymentReview(db, proofs, refs, risk, orders, customers, paymentNotifier);
const reports = new PaymentReports(db, proofs, orders, paymentNotifier);
const records = new PaymentRecords(db, proofs, orders, customers, risk);

const bot = createBot({
  token: 'test',
  botInfo,
  ownedShopIds: (telegramUserId) => shops.ownedShopIds(telegramUserId),
  driverShopIds: () => Promise.resolve([]),
  handlers: [
    createConversationHandlers({ conversations, customers }),
    createPaymentHandlers({
      intake,
      review,
      reports,
      customers,
      chat: new TelegramCustomerChat(chatApi),
    }),
  ],
});
fakeTelegram(bot.api);

const ownerA = 880501;
const ownerB = 880601;
const userOf = (id: number, name: string): User => ({ id, is_bot: false, first_name: name });
const privateChat = (user: User): Chat.PrivateChat => ({
  id: user.id,
  type: 'private',
  first_name: user.first_name,
});

let updateId = 1;
const photo = (from: User): Update => ({
  update_id: updateId++,
  message: {
    message_id: updateId,
    date: 0,
    chat: privateChat(from),
    from,
    photo: [{ file_id: `photo-${String(updateId)}`, file_unique_id: 'u', width: 1, height: 1 }],
  },
});
const tap = (from: User, data: string): Update => ({
  update_id: updateId++,
  callback_query: {
    id: String(updateId),
    from,
    chat_instance: '1',
    data,
    message: { message_id: 1, date: 0, chat: privateChat(from), text: 'review' },
  },
});

const lastTo = (chatId: number) => calls.filter((call) => call.chatId === chatId).at(-1);
const lastAnswer = () => calls.filter((call) => call.method === 'answerCallbackQuery').at(-1);

const shopA = { id: '', bigVariant: '', smallVariant: '' };
const shopB = { id: '', bigVariant: '', smallVariant: '' };

async function setUpShop(
  shop: typeof shopA,
  owner: number,
  account: { accountName: string; accountNumber: string },
) {
  shop.id = await shops.create(owner, { name: `Shop ${String(owner)}` });
  await shops.setPaymentAccounts(shop.id, [{ provider: 'telebirr', ...account }]);
  for (const [price, key] of [
    ['4500', 'bigVariant'],
    ['800', 'smallVariant'],
  ] as const) {
    const product = await catalog.createProduct(
      shop.id,
      productInputSchema.parse({ title: `Shoes ${price}`, pricingMode: 'fixed', price }),
    );
    await catalog.setVariants(shop.id, product.id, [{ size: '42', color: null, stock: 10 }]);
    const listed = (await catalog.listProducts(shop.id)).find((p) => p.id === product.id);
    shop[key] = listed?.variants[0]?.id ?? '';
  }
}

/** Places an order for the customer, who already shared a phone number, and returns its ID. */
async function order(customer: User, shopId: string, variantId: string): Promise<string> {
  const buyer = { telegramUserId: customer.id, name: customer.first_name };
  await customers.startSession(customer.id, shopId, null);
  await checkout.completeWithPhone(shopId, buyer, `+25191${String(customer.id)}`, variantId);
  const placed = await orders.latestUnpaid(shopId, customer.id);
  if (!placed) throw new Error('No order was placed');
  return placed.id;
}

/** The current time in Addis Ababa as a receipt prints it, moved by some minutes. */
function receiptTime(minutesFromNow: number): string {
  const time = new Date(Date.now() + minutesFromNow * 60_000);
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Africa/Addis_Ababa',
    dateStyle: 'short',
    timeStyle: 'medium',
  })
    .format(time)
    .replace(' ', 'T');
}

const sure = <T>(value: T) => ({ value, confidence: 0.95 });

/** The model classifies the photo as a receipt and reads these fields from it. */
function receiptScript(fields: {
  ref: string;
  amount: string;
  receiver: string;
  account: string;
  paidAt?: string;
}) {
  script.push(
    { text: JSON.stringify({ kind: 'receipt', confidence: 0.97 }) },
    {
      text: JSON.stringify({
        provider: sure('telebirr'),
        transactionRef: sure(fields.ref),
        amount: sure(fields.amount),
        receiverName: sure(fields.receiver),
        receiverAccount: sure(fields.account),
        payerName: sure(null),
        payerAccount: sure(null),
        paidAt: sure(fields.paidAt ?? receiptTime(1)),
      }),
    },
  );
}

const toShopA = { receiver: 'SELAM TESFAYE', account: '2519****4567' };
const toShopB = { receiver: 'ABEL GIRMA', account: '2519****0000' };

const statusOf = async (shopId: string, orderId: string) =>
  (await orders.get(shopId, orderId)).status;

const variantOf = async (shopId: string, variantId: string) =>
  (await catalog.listProducts(shopId)).flatMap((p) => p.variants).find((v) => v.id === variantId);

const markupOf = (call: Call | undefined) => JSON.stringify(call?.payload.reply_markup);

beforeAll(async () => {
  await setUpShop(shopA, ownerA, { accountName: 'Selam Tesfaye', accountNumber: '0911234567' });
  await setUpShop(shopB, ownerB, { accountName: 'Abel Girma', accountNumber: '0922000000' });
});

describe('a payment screenshot', () => {
  const hana = userOf(424301, 'Hana');

  it('pays the order when the rules pass and the bank confirms, and tells both sides', async () => {
    const orderId = await order(hana, shopA.id, shopA.bigVariant);
    receiptScript({ ref: 'DG92OT8YDE', amount: '4500', ...toShopA });
    bankSays = 'CONFIRMED';

    await bot.handleUpdate(photo(hana));

    expect(await statusOf(shopA.id, orderId)).toBe('paid');
    const variants = (await catalog.listProducts(shopA.id)).flatMap((p) => p.variants);
    expect(variants.find((v) => v.id === shopA.bigVariant)).toMatchObject({
      stock: 9,
      reserved: 0,
    });
    expect(lastTo(hana.id)?.text).toContain('Payment received for order');
    expect(lastTo(ownerA)?.text).toMatch(/Paid: order #[0-9A-F]{6} · 4,500.00 ብር · bank-verified/);
  });

  it('rejects the same reference at another shop, without accusing the customer', async () => {
    const dawit = userOf(424302, 'Dawit');
    const orderId = await order(dawit, shopB.id, shopB.bigVariant);
    receiptScript({ ref: 'DG92OT8YDE', amount: '4500', ...toShopB });

    await bot.handleUpdate(photo(dawit));

    expect(await statusOf(shopB.id, orderId)).toBe('payment_rejected');
    expect(lastTo(dawit.id)?.text).toContain('already used for another order');
    expect(markupOf(lastTo(dawit.id))).toContain(`payreport:${orderId}`);
    expect(lastTo(ownerB)?.text).toContain('not accepted');
    expect(lastTo(ownerB)?.text).not.toContain(String(dawit.id));
  });

  it('asks for the difference of a partial payment, then accepts the rest', async () => {
    const sara = userOf(424303, 'Sara');
    const orderId = await order(sara, shopA.id, shopA.bigVariant);
    receiptScript({ ref: 'AAAA111111', amount: '1000', ...toShopA });
    const checkedAt = Date.now();
    await bot.handleUpdate(photo(sara));
    expect(lastTo(sara.id)?.text).toContain('3,500.00 ብር is still missing');
    // The customer gets a new hold to pay the rest, since the check may have outlasted the first.
    const waiting = await orders.get(shopA.id, orderId);
    expect(waiting.status).toBe('awaiting_payment');
    expect(waiting.paymentDeadline?.getTime()).toBeGreaterThanOrEqual(checkedAt + PAYMENT_HOLD_MS);

    receiptScript({ ref: 'AAAA111111', amount: '1000', ...toShopA });
    await bot.handleUpdate(photo(sara));
    expect(lastTo(sara.id)?.text).toContain('3,500.00 ብር is still missing');

    receiptScript({ ref: 'BBBB222222', amount: '3500', ...toShopA });
    await bot.handleUpdate(photo(sara));
    expect(await statusOf(shopA.id, orderId)).toBe('paid');
  });

  it('approves a small payment when the bank page is unavailable', async () => {
    const meron = userOf(424304, 'Meron');
    const orderId = await order(meron, shopA.id, shopA.smallVariant);
    receiptScript({ ref: 'CCCC333333', amount: '800', ...toShopA });
    bankSays = 'UNAVAILABLE';

    await bot.handleUpdate(photo(meron));

    expect(await statusOf(shopA.id, orderId)).toBe('paid');
    expect(lastTo(ownerA)?.text).toContain('not bank-verified');
  });

  it('answers a product photo without touching the order', async () => {
    const liya = userOf(424305, 'Liya');
    const orderId = await order(liya, shopA.id, shopA.smallVariant);
    script.push({ text: JSON.stringify({ kind: 'product', confidence: 0.9 }) });

    await bot.handleUpdate(photo(liya));

    expect(await statusOf(shopA.id, orderId)).toBe('awaiting_payment');
    expect(lastTo(liya.id)?.text).toContain('tap Buy on the product');
  });
});

describe('owner review', () => {
  it('sends a screenshot Buchi cannot read to the owners, who approve it', async () => {
    const abebe = userOf(424306, 'Abebe');
    const orderId = await order(abebe, shopA.id, shopA.bigVariant);
    script.push(
      { text: JSON.stringify({ kind: 'receipt', confidence: 0.9 }) },
      { text: 'I think this says 4500 birr' },
    );

    await bot.handleUpdate(photo(abebe));

    expect(await statusOf(shopA.id, orderId)).toBe('needs_review');
    expect(lastTo(abebe.id)?.text).toContain('The shop is checking your payment');
    const reviewMessage = lastTo(ownerA);
    expect(reviewMessage).toMatchObject({ method: 'copyMessage' });
    expect(reviewMessage?.text).toContain('Buchi could not read the screenshot.');
    const markup = JSON.stringify(reviewMessage?.payload.reply_markup);
    const approve = /payment:approve:[0-9a-f-]{36}/.exec(markup)?.[0] ?? '';

    await bot.handleUpdate(tap(userOf(ownerB, 'Other'), approve));
    expect(lastAnswer()?.text).toBe("Only this shop's owners can do this.");
    await bot.handleUpdate(tap(abebe, approve));
    expect(lastAnswer()?.text).toBe("Only this shop's owners can do this.");
    expect(await statusOf(shopA.id, orderId)).toBe('needs_review');

    await bot.handleUpdate(tap(userOf(ownerA, 'Selam'), approve));
    expect(await statusOf(shopA.id, orderId)).toBe('paid');
    expect(lastTo(abebe.id)?.text).toContain('Payment received for order');

    await bot.handleUpdate(tap(userOf(ownerA, 'Selam'), approve));
    expect(lastAnswer()?.text).toBe('This payment was already decided.');
  });

  it('sends the screenshot to the owners when Gemini has no quota left', async () => {
    const hirut = userOf(424310, 'Hirut');
    const orderId = await order(hirut, shopA.id, shopA.smallVariant);
    const quota = new AppError('QUOTA_EXHAUSTED', 'No Gemini quota left');
    script.push({ error: quota }, { error: quota });

    await bot.handleUpdate(photo(hirut));

    expect(await statusOf(shopA.id, orderId)).toBe('needs_review');
    expect(lastTo(hirut.id)?.text).toContain('The shop is checking your payment');
    expect(lastTo(ownerA)?.text).toContain('Buchi could not read the screenshot.');
  });

  it('sends a high-risk payer to review when the bank page is unavailable', async () => {
    const kebede = userOf(424307, 'Kebede');
    // Rejected screenshots at two shops make Kebede high risk.
    await order(kebede, shopB.id, shopB.smallVariant);
    receiptScript({ ref: 'DDDD444444', amount: '800', ...toShopB, paidAt: receiptTime(-60) });
    await bot.handleUpdate(photo(kebede));
    await order(kebede, shopA.id, shopA.smallVariant);
    receiptScript({ ref: 'EEEE555555', amount: '800', ...toShopA, paidAt: receiptTime(-60) });
    await bot.handleUpdate(photo(kebede));
    expect(lastTo(kebede.id)?.text).toContain('made before this order was placed');

    const orderId = await order(kebede, shopA.id, shopA.smallVariant);
    receiptScript({ ref: 'FFFF666666', amount: '800', ...toShopA });
    bankSays = 'UNAVAILABLE';
    await bot.handleUpdate(photo(kebede));

    expect(await statusOf(shopA.id, orderId)).toBe('needs_review');
    expect(lastTo(ownerA)?.text).toContain('this payer had payment problems before');
  });

  it('closes the order when the owner rejects it, and frees its stock and reference', async () => {
    const tigist = userOf(424308, 'Tigist');
    const orderId = await order(tigist, shopA.id, shopA.bigVariant);
    receiptScript({ ref: 'GGGG777777', amount: '4500', ...toShopA });
    bankSays = 'NOT_FOUND';
    await bot.handleUpdate(photo(tigist));
    const markup = JSON.stringify(lastTo(ownerA)?.payload.reply_markup);
    const reject = /payment:reject:[0-9a-f-]{36}/.exec(markup)?.[0] ?? '';

    const reserved = (await variantOf(shopA.id, shopA.bigVariant))?.reserved ?? 0;

    await bot.handleUpdate(tap(userOf(ownerA, 'Selam'), reject));

    expect(await statusOf(shopA.id, orderId)).toBe('payment_rejected');
    expect((await variantOf(shopA.id, shopA.bigVariant))?.reserved).toBe(reserved - 1);
    expect(lastTo(tigist.id)?.text).toContain('so this order is closed');
    const rightful = await order(userOf(424309, 'Yonas'), shopA.id, shopA.smallVariant);
    expect(await refs.claim('telebirr', 'GGGG777777', rightful)).toBe(rightful);
  });
});

describe('a rejected payment', () => {
  const selam = userOf(ownerA, 'Selam');
  const ruth = userOf(424311, 'Ruth');
  let orderId = '';

  it('closes the order, frees its stock at once, and offers Report a problem', async () => {
    const reserved = (await variantOf(shopA.id, shopA.smallVariant))?.reserved ?? 0;
    orderId = await order(ruth, shopA.id, shopA.smallVariant);
    receiptScript({ ref: 'HHHH888888', amount: '800', ...toShopA, paidAt: receiptTime(-60) });

    await bot.handleUpdate(photo(ruth));

    expect(await statusOf(shopA.id, orderId)).toBe('payment_rejected');
    expect((await variantOf(shopA.id, shopA.smallVariant))?.reserved).toBe(reserved);
    const reply = lastTo(ruth.id);
    expect(reply?.text).toContain('This order is now closed and the item is back on sale');
    expect(markupOf(reply)).toContain('Report a problem');
    expect(markupOf(reply)).toContain(`payreport:${orderId}`);
  });

  it('takes no more screenshots for the closed order', async () => {
    script.push({ text: JSON.stringify({ kind: 'receipt', confidence: 0.97 }) });

    await bot.handleUpdate(photo(ruth));

    expect(lastTo(ruth.id)?.text).toContain('was not accepted, so this order is closed');
    expect(await statusOf(shopA.id, orderId)).toBe('payment_rejected');
  });

  it('sends a report from its own customer, once, to the owners with what Buchi read', async () => {
    await bot.handleUpdate(tap(userOf(424312, 'Other'), `payreport:${orderId}`));
    expect(lastAnswer()?.text).toBe('This payment was already reported or decided.');

    await bot.handleUpdate(tap(ruth, `payreport:${orderId}`));

    expect(lastAnswer()?.text).toContain('The shop will check your payment');
    const report = lastTo(ownerA)?.text;
    expect(report).toContain('The customer reports a problem with the rejected payment');
    expect(report).toContain('the payment was made before this order was placed');
    expect(report).toContain('HHHH888888');
    const queued = (await records.reviewQueue(shopA.id)).find((i) => i.orderId === orderId);
    expect(queued).toMatchObject({ customerReported: true, reasons: ['time'] });

    await bot.handleUpdate(tap(ruth, `payreport:${orderId}`));
    expect(lastAnswer()?.text).toBe('This payment was already reported or decided.');
  });

  it('sells the order after all when the owner approves the report', async () => {
    const before = await variantOf(shopA.id, shopA.smallVariant);
    const approve = /payment:approve:[0-9a-f-]{36}/.exec(markupOf(lastTo(ownerA)))?.[0] ?? '';

    await bot.handleUpdate(tap(selam, approve));

    expect(lastAnswer()?.text).toBe('Approved. The customer is told the payment is confirmed.');
    expect(await statusOf(shopA.id, orderId)).toBe('paid');
    expect(await variantOf(shopA.id, shopA.smallVariant)).toMatchObject({
      stock: (before?.stock ?? 0) - 1,
      reserved: before?.reserved,
    });
    expect(lastTo(ruth.id)?.text).toContain('Payment received for order');
    const other = await order(userOf(424313, 'Yared'), shopA.id, shopA.smallVariant);
    expect(await refs.claim('telebirr', 'HHHH888888', other)).toBe(orderId);
  });

  it('tells the owner when the item sold out meanwhile, and keeps the report open', async () => {
    const product = await catalog.createProduct(
      shopA.id,
      productInputSchema.parse({ title: 'Last pair', pricingMode: 'fixed', price: '800' }),
    );
    await catalog.setVariants(shopA.id, product.id, [{ size: '40', color: null, stock: 1 }]);
    const lastPair = (await catalog.listProducts(shopA.id)).find((p) => p.id === product.id)
      ?.variants[0]?.id;
    if (!lastPair) throw new Error('The variant is missing');
    const abel = userOf(424314, 'Abel');
    const rejected = await order(abel, shopA.id, lastPair);
    receiptScript({ ref: 'JJJJ999999', amount: '800', ...toShopA, paidAt: receiptTime(-60) });
    await bot.handleUpdate(photo(abel));
    await order(userOf(424315, 'Liya'), shopA.id, lastPair);
    await bot.handleUpdate(tap(abel, `payreport:${rejected}`));
    const markup = markupOf(lastTo(ownerA));
    const approve = /payment:approve:[0-9a-f-]{36}/.exec(markup)?.[0] ?? '';
    const reject = /payment:reject:[0-9a-f-]{36}/.exec(markup)?.[0] ?? '';

    await bot.handleUpdate(tap(selam, approve));

    expect(lastAnswer()?.text).toContain('The item sold out after the order was closed');
    expect(await statusOf(shopA.id, rejected)).toBe('payment_rejected');
    expect(await variantOf(shopA.id, lastPair)).toMatchObject({ stock: 1, reserved: 1 });
    expect((await records.reviewQueue(shopA.id)).map((i) => i.orderId)).toContain(rejected);

    await bot.handleUpdate(tap(selam, reject));

    expect(lastAnswer()?.text).toBe('Rejected. The customer is told the order is closed.');
    expect(await statusOf(shopA.id, rejected)).toBe('payment_rejected');
    expect(lastTo(abel.id)?.text).toContain('so this order is closed');
    expect((await records.reviewQueue(shopA.id)).map((i) => i.orderId)).not.toContain(rejected);
  });
});
