import { Money, productInputSchema } from '@buchi/shared';
import type { FunctionCall } from '@google/genai';
import type { Chat, Update, User } from 'grammy/types';
import { eq } from 'drizzle-orm';
import type { Database } from '../../src/db/client';
import { agentDecisions } from '../../src/db/schema';
import { withShop } from '../../src/db/with-shop';
import type { Coordinates } from '../../src/modules/delivery/location.domain';
import type { createOperationsBot, SentMessage } from './operations-bot';
import type { ScriptedTurn } from './scripted-model';

type OperationsBot = ReturnType<typeof createOperationsBot>;

/** One model turn with these function calls. */
export const calls = (...list: [string, Record<string, unknown>][]): ScriptedTurn => ({
  calls: list.map(([name, args]) => ({ name, args }) satisfies FunctionCall),
});
export const done: ScriptedTurn = { text: 'Done.' };

export const shopPin = { latitude: 9.0108, longitude: 38.7613 };
export const customerPin = { latitude: 9.0203, longitude: 38.8027 };

let updateId = 1;
const privateChat = (user: User): Chat.PrivateChat => ({
  id: user.id,
  type: 'private',
  first_name: user.first_name,
});

export const userOf = (id: number, name: string, username?: string): User => ({
  id,
  is_bot: false,
  first_name: name,
  ...(username === undefined ? {} : { username }),
});

export const text = (from: User, body: string): Update => ({
  update_id: updateId++,
  message: { message_id: updateId, date: 0, chat: privateChat(from), from, text: body },
});

export const location = (from: User, point: Coordinates): Update => ({
  update_id: updateId++,
  message: { message_id: updateId, date: 0, chat: privateChat(from), from, location: point },
});

export const tap = (from: User, data: string): Update => ({
  update_id: updateId++,
  callback_query: {
    id: String(updateId),
    from,
    chat_instance: '1',
    data,
    message: { message_id: 1, date: 0, chat: privateChat(from), text: 'button' },
  },
});

/** The callback data of a sent message's buttons. */
export function buttonsOf(message: SentMessage | undefined): string[] {
  const markup = message?.payload.reply_markup;
  if (typeof markup !== 'object' || markup === null || !('inline_keyboard' in markup)) return [];
  const rows = markup.inline_keyboard as { callback_data: string }[][];
  return rows.flat().map((button) => button.callback_data);
}

/** Helpers bound to one bot: a shop with a product in two sizes, drivers, and orders. */
export function operationsWorld(db: Database, world: OperationsBot) {
  const { bot, sent, services } = world;
  const { shops, catalog, customers, orders, delivery, drivers } = services;

  const sentTo = (chatId: number) =>
    sent.filter((m) => m.method === 'sendMessage' && m.chatId === chatId);
  const lastTo = (chatId: number) => sentTo(chatId).at(-1);
  const answers = () =>
    sent.filter((m) => m.method === 'answerCallbackQuery').map((m) => m.payload.text);

  async function setUpShop(owner: number, stock: { size42: number; size43: number }) {
    const shopId = await shops.create(owner, { name: `Shop ${String(owner)}` });
    await shops.setLocation(shopId, shopPin);
    await delivery.saveSettings(shopId, {
      baseFee: '40',
      ratePerKm: '12.50',
      ratePerMinute: '1.50',
      freeRadiusKm: 2.5,
      standardRangeKm: 8,
      farRangeKm: 20,
      farCap: '1000',
      saverDiscountPercent: 15,
    });
    const product = await catalog.createProduct(
      shopId,
      productInputSchema.parse({ title: 'Nike Air', pricingMode: 'fixed', price: '3500' }),
    );
    await catalog.setVariants(shopId, product.id, [
      { size: '42', color: null, stock: stock.size42 },
      { size: '43', color: null, stock: stock.size43 },
    ]);
    const [listed] = await catalog.listProducts(shopId);
    const size = (label: string) => listed?.variants.find((v) => v.size === label)?.id ?? '';
    return { shopId, size42: size('42'), size43: size('43') };
  }

  async function addDriver(shopId: string, user: User): Promise<void> {
    const username = user.username ?? '';
    const { link } = await drivers.invite(shopId, username);
    const token = link.split('start=drv_')[1] ?? '';
    await drivers.link(token, { telegramUserId: user.id, username, name: user.first_name });
    await drivers.savePhone(user.id, `+2519${String(user.id)}`);
    await drivers.setAvailability(user.id, true);
  }

  async function unpaidOrder(
    shopId: string,
    variantId: string,
    customer: User,
    paymentDeadline: Date,
  ) {
    const row = await customers.identify(shopId, customer.id, customer.first_name);
    await customers.startSession(customer.id, shopId, null);
    return orders.create(
      shopId,
      {
        customerId: row.id,
        items: [{ variantId, quantity: 1 }],
        delivery: { type: 'express', fee: Money.of('125'), destination: customerPin },
        paymentDeadline,
      },
      'customer',
    );
  }

  /** A paid Express order, which dispatch offers to the shop's available drivers at once. */
  async function paidOrder(shopId: string, variantId: string, customer: User): Promise<string> {
    const deadline = new Date(Date.now() + 3 * 60 * 60_000);
    const order = await unpaidOrder(shopId, variantId, customer, deadline);
    await orders.transition(shopId, order.id, 'payment_submitted', 'customer', 'Screenshot');
    await orders.transition(shopId, order.id, 'payment_approved', 'system', 'Paid');
    return order.id;
  }

  function offerIdFor(driverId: number): string {
    const accept = buttonsOf(lastTo(driverId)).find((data) => data.startsWith('job:accept:'));
    if (!accept) throw new Error('The driver has no offer');
    return accept.slice('job:accept:'.length);
  }

  /** The driver accepts the latest offer and picks it up. Returns the job's ID. */
  async function onTheWay(driver: User): Promise<string> {
    await bot.handleUpdate(tap(driver, `job:accept:${offerIdFor(driver.id)}`));
    const picked = buttonsOf(lastTo(driver.id))[0] ?? '';
    await bot.handleUpdate(tap(driver, picked));
    return picked.slice('job:picked:'.length);
  }

  /** The driver delivers the stop they were last prompted for, at the customer's pin. */
  async function deliver(driver: User): Promise<void> {
    const prompt = sentTo(driver.id).findLast((m) =>
      buttonsOf(m).some((data) => data.startsWith('job:delivered:')),
    );
    await bot.handleUpdate(tap(driver, buttonsOf(prompt)[0] ?? ''));
    await bot.handleUpdate(location(driver, customerPin));
  }

  const decisionsOf = (shopId: string) =>
    withShop(db, shopId, (tx) =>
      tx.select().from(agentDecisions).where(eq(agentDecisions.shopId, shopId)),
    );

  /** The **Approve** or **Decline** button data of the owner's latest approval request. */
  function approvalButton(owner: number, choice: 'approve' | 'decline'): string {
    const request = sentTo(owner).findLast((m) => m.text?.includes('🤖'));
    const data = buttonsOf(request).find((d) => d.startsWith(`approval:${choice}:`));
    if (!data) throw new Error('The owner has no approval request');
    return data;
  }

  return {
    sentTo,
    lastTo,
    answers,
    setUpShop,
    addDriver,
    unpaidOrder,
    paidOrder,
    offerIdFor,
    onTheWay,
    deliver,
    decisionsOf,
    approvalButton,
  };
}
