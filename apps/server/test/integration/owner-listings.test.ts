import { productInputSchema } from '@buchi/shared';
import { and, eq } from 'drizzle-orm';
import type { Chat, Update, User } from 'grammy/types';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connectDatabase } from '../../src/db/client';
import { productVariants, stockHolds, timers as timersTable, waitlist } from '../../src/db/schema';
import { withShop } from '../../src/db/with-shop';
import { orderTimerKinds } from '../../src/modules/orders/orders.deadlines.domain';
import { buttonsOf, tap, userOf } from '../fakes/operations-fixtures';
import { CHANNEL_CHAT_ID, createOwnerBot, type Clock } from '../fakes/owner-bot';
import { ScriptedModel, type ScriptedTurn } from '../fakes/scripted-model';
import { testDatabaseUrl } from './test-database';

const { db, close } = connectDatabase(testDatabaseUrl);
afterAll(close);

/** Every product text embeds to the same direction, so it matches a request near it. */
const sneakerDirection = Array.from({ length: 768 }, (_, i) => (i === 0 ? 1 : 0));
const clock: Clock = { now: new Date() };
const script: ScriptedTurn[] = [];
const { bot, sent, posts, timers, services } = createOwnerBot(
  db,
  new ScriptedModel(script, () => sneakerDirection),
  clock,
);
const { shops, catalog, customers, orders, demand } = services;

const owner = userOf(900001, 'Selam');
let shopId = '';
let updateId = 50_000;

const privateChat = (user: User): Chat.PrivateChat => ({
  id: user.id,
  type: 'private',
  first_name: user.first_name,
});

const photo = (
  from: User,
  caption: string | undefined,
  fileId: string,
  album?: string,
): Update => ({
  update_id: updateId++,
  message: {
    message_id: updateId,
    date: 0,
    chat: privateChat(from),
    from,
    photo: [{ file_id: fileId, file_unique_id: fileId, width: 800, height: 800 }],
    ...(caption === undefined ? {} : { caption }),
    ...(album === undefined ? {} : { media_group_id: album }),
  },
});

const message = (from: User, extra: Record<string, unknown>): Update => ({
  update_id: updateId++,
  message: { message_id: updateId, date: 0, chat: privateChat(from), from, ...extra },
});

const replyTo = (from: User, messageId: number, body: string) =>
  message(from, {
    text: body,
    reply_to_message: { message_id: messageId, date: 0, chat: privateChat(from) },
  });

/** The model's draft. It even names a price, which code must never use. */
const drafted = (sizes: string[]): ScriptedTurn => ({
  text: JSON.stringify({
    title: { en: 'Nike Air', am: 'ናይኪ ኤር' },
    description: { en: 'Black leather sneakers.', am: 'ጥቁር የቆዳ ስኒከር።' },
    category: 'sneakers',
    colors: ['black'],
    sizes,
    price: '99',
  }),
});

const draftMessage = () => sent.findLast((m) => m.chatId === owner.id && m.text?.startsWith('📝'));
const lastTo = (chatId: number) => sent.findLast((m) => m.chatId === chatId && m.text);
const textsTo = (chatId: number) => sent.filter((m) => m.chatId === chatId).map((m) => m.text);

beforeAll(async () => {
  shopId = await shops.create(owner.id, { name: 'Selam Shoes' });
  await shops.connectChannel(shopId, '@selamshoes');
});

beforeEach(() => {
  expect(script).toEqual([]);
});

describe('snap-to-list', () => {
  it('drafts a photo and note, takes the price only from the note, and posts it', async () => {
    clock.now = new Date();
    script.push(drafted(['40', '41', '42', '43', '44']));
    await bot.handleUpdate(photo(owner, 'Nike Air 40-44 ጥቁር 3500 x2', 'file-1', 'album-1'));
    await bot.handleUpdate(photo(owner, undefined, 'file-2', 'album-1'));

    const draft = draftMessage();
    expect(draft?.text).toContain('Price: 3,500.00 ብር (from your note)');
    expect(draft?.text).not.toContain('99');
    const [post] = buttonsOf(draft);
    await bot.handleUpdate(tap(owner, post ?? ''));

    expect(lastTo(owner.id)?.text).toBe('📤 Posted to your channel: Nike Air · ናይኪ ኤር');
    expect(posts.at(-1)).toMatchObject({ chatId: CHANNEL_CHAT_ID });
    expect(posts.at(-1)?.caption).toContain('3,500.00 ብር');
    const [listed] = await catalog.listProducts(shopId);
    expect(listed).toMatchObject({ pricingMode: 'fixed', price: '3500.00', lowestPrice: null });
    expect(listed?.photoFileIds).toEqual(['file-1', 'file-2']);
    expect(listed?.variants.map((v) => [v.size, v.color, v.stock])).toEqual(
      ['40', '41', '42', '43', '44'].map((size) => [size, 'black', 2]),
    );
    const embedTimers = await db
      .select()
      .from(timersTable)
      .where(
        and(eq(timersTable.kind, 'product.embed'), eq(timersTable.targetId, listed?.id ?? '')),
      );
    expect(embedTimers).toHaveLength(1);

    await bot.handleUpdate(tap(owner, post ?? ''));
    expect(sent.findLast((m) => m.method === 'answerCallbackQuery')).toBeDefined();
    expect(await catalog.listProducts(shopId)).toHaveLength(1);
  });

  it('asks for a negotiable price in private, then posts with the prices the owner wrote', async () => {
    script.push(drafted(['39', '40', '41']));
    await bot.handleUpdate(photo(owner, 'Boots 39-41 negotiable', 'file-3'));
    const draft = draftMessage();
    expect(draft?.text).toContain('reply to this message with the asking and the lowest price');
    expect(buttonsOf(draft)).toHaveLength(2);

    await bot.handleUpdate(replyTo(owner, draft?.messageId ?? 0, '3000 3500'));
    const edited = sent.findLast((m) => m.method === 'editMessageText');
    expect(edited?.text).toContain('Negotiable: asking 3,500.00 ብር, lowest 3,000.00 ብር (private)');
    const [post] = buttonsOf(edited);
    await bot.handleUpdate(tap(owner, post ?? ''));

    const boots = (await catalog.listProducts(shopId)).find((p) => p.photoFileIds[0] === 'file-3');
    expect(boots).toMatchObject({
      pricingMode: 'negotiable',
      price: '3500.00',
      lowestPrice: '3000.00',
    });
    expect(posts.at(-1)?.caption).not.toContain('3,500');
  });

  it('drafts again from a new note, and discards', async () => {
    script.push(drafted(['42']), drafted(['42', '43']));
    await bot.handleUpdate(photo(owner, 'Nike Air 42 4000', 'file-4'));
    const draft = draftMessage();
    await bot.handleUpdate(replyTo(owner, draft?.messageId ?? 0, 'Nike Air 42-43 3900'));
    const edited = sent.findLast((m) => m.method === 'editMessageText');
    expect(edited?.text).toContain('Sizes: 42, 43');
    expect(edited?.text).toContain('Price: 3,900.00 ብር');

    await bot.handleUpdate(tap(owner, buttonsOf(edited)[2] ?? ''));
    expect(lastTo(owner.id)?.text).toBe('🗑 Draft discarded.');
    expect(
      (await catalog.listProducts(shopId)).some((p) => p.photoFileIds.includes('file-4')),
    ).toBe(false);
  });

  it('keeps a photo without a note for the attach-to-product flow', async () => {
    await bot.handleUpdate(photo(owner, undefined, 'file-5'));
    expect(lastTo(owner.id)?.text).toContain('Which product is this photo for?');
  });
});

describe('the restock waitlist', () => {
  const hana = userOf(900101, 'Hana');
  const abel = userOf(900102, 'Abel');
  let variantId = '';
  let productId = '';

  const reserved = async () => {
    const [row] = await withShop(db, shopId, (tx) =>
      tx.select().from(productVariants).where(eq(productVariants.id, variantId)),
    );
    return row?.reserved;
  };
  const holdTimers = () =>
    db.select().from(timersTable).where(eq(timersTable.kind, orderTimerKinds.holdExpire));

  beforeAll(async () => {
    const product = await catalog.createProduct(
      shopId,
      productInputSchema.parse({ title: 'Adidas Samba', pricingMode: 'fixed', price: '3200' }),
    );
    productId = product.id;
    await catalog.setVariants(shopId, productId, [{ size: '42', color: null, stock: 0 }]);
    const [listed] = await catalog.activeProducts(shopId, [productId]);
    variantId = listed?.variants[0]?.id ?? '';
    for (const user of [hana, abel]) {
      const customer = await customers.identify(shopId, user.id, user.first_name);
      await demand.joinWaitlist(shopId, customer.id, variantId);
    }
  });

  it('holds one unit for the first customer in line for 30 minutes and tells them', async () => {
    clock.now = new Date();
    await catalog.setVariants(shopId, productId, [{ size: '42', color: null, stock: 1 }]);

    expect(await reserved()).toBe(1);
    const [notice, card] = textsTo(hana.id);
    expect(notice).toContain('Adidas Samba · መጠን / size 42');
    expect(card).toContain('Choose your size');
    expect(textsTo(abel.id)).toEqual([]);
    const [timer] = await holdTimers();
    expect(timer?.dueAt.getTime()).toBe(clock.now.getTime() + 30 * 60_000);
  });

  it('passes the unit to the next customer when the hold runs out', async () => {
    await db
      .update(timersTable)
      .set({ dueAt: new Date(Date.now() - 1000) })
      .where(eq(timersTable.kind, orderTimerKinds.holdExpire));
    await timers.tick();

    expect(await reserved()).toBe(1);
    expect(textsTo(abel.id)[0]).toContain('I am holding one for you');
    const waiting = await withShop(db, shopId, (tx) => tx.select().from(waitlist));
    expect(waiting.every((entry) => entry.notifiedAt !== null)).toBe(true);
  });

  it("uses the held unit for that customer's order, without reserving another", async () => {
    const customer = await customers.identify(shopId, abel.id, 'Abel');
    const order = await orders.create(
      shopId,
      {
        customerId: customer.id,
        items: [{ variantId, quantity: 1 }],
        delivery: { type: 'pickup' },
        paymentDeadline: new Date(Date.now() + 3_600_000),
      },
      'customer',
    );
    expect(order.status).toBe('awaiting_payment');
    expect(await reserved()).toBe(1);
    const holds = await withShop(db, shopId, (tx) =>
      tx.select().from(stockHolds).where(eq(stockHolds.customerId, customer.id)),
    );
    expect(holds.map((hold) => hold.status)).toEqual(['used']);

    await db
      .update(timersTable)
      .set({ dueAt: new Date(Date.now() - 1000) })
      .where(eq(timersTable.kind, orderTimerKinds.holdExpire));
    await timers.tick();
    expect(await reserved()).toBe(1);
  });
});

describe('Notify me requests', () => {
  it('get a message when a similar product is listed', async () => {
    const asker = userOf(900201, 'Mimi');
    const customer = await customers.identify(shopId, asker.id, 'Mimi');
    const signalId = await demand.recordUnmet(shopId, customer.id, {
      description: 'white high-top sneakers',
      embedding: sneakerDirection,
    });
    await demand.requestNotify(shopId, customer.id, signalId);

    const product = await catalog.createProduct(
      shopId,
      productInputSchema.parse({ title: 'White high-tops', pricingMode: 'fixed', price: '2900' }),
    );
    await catalog.setVariants(shopId, product.id, [{ size: '40', color: null, stock: 3 }]);
    await timers.tick();

    expect(textsTo(asker.id)[0]).toContain('just arrived: White high-tops');
    await catalog.updateProduct(
      shopId,
      product.id,
      productInputSchema.parse({
        title: 'White high-tops v2',
        pricingMode: 'fixed',
        price: '2900',
      }),
    );
    const before = sent.length;
    await timers.tick();
    expect(sent.slice(before).filter((m) => m.chatId === asker.id)).toEqual([]);
  });
});
