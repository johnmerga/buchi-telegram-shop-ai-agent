import { coordinatesSchema, formatBirr } from '@buchi/shared';
import { Composer, InlineKeyboard, type Context } from 'grammy';
import type { User } from 'grammy/types';
import { AppError } from '../../shared/errors';
import type { BuchiContext } from '../../telegram/actor';
import { CONFIRM_PLACE_DATA, type TelegramCustomerChat } from '../../telegram/customer-chat';
import { oneButtonPerRow, PICKUP_TEXT } from '../../telegram/keyboards';
import type { CatalogService } from '../catalog/catalog.service';
import { postIdFromStartPayload } from '../catalog/catalog.domain';
import type { CustomersService } from '../customers/customers.service';
import type { PricedDeliveryType } from '../delivery/fees.domain';
import type { LandmarkService } from '../delivery/landmarks.service';
import { checkPin, type PinResult } from '../delivery/location.domain';
import type { LocationService } from '../delivery/location.service';
import type { FarQuoteService } from '../far-quotes/far-quotes.service';
import type { CheckoutService, CheckoutStep } from './checkout.service';
import { deliveryChoice, pinRequest } from './delivery-choice.domain';
import { deliveryChoiceCallbackSchema } from './orders.schemas';

const UUID = '([0-9a-f-]{36})';

export interface PurchaseDeps {
  catalog: CatalogService;
  customers: CustomersService;
  checkout: CheckoutService;
  locations: Pick<LocationService, 'fromText'>;
  landmarks: Pick<LandmarkService, 'confirm'>;
  chat: Pick<TelegramCustomerChat, 'productCard' | 'orderStep' | 'askForPin'>;
  farQuotes: Pick<FarQuoteService, 'start'>;
}

type Session = NonNullable<Awaited<ReturnType<CustomersService['sessionOf']>>>;

const buyerOf = (from: User) => ({
  telegramUserId: from.id,
  name: [from.first_name, from.last_name].filter(Boolean).join(' '),
});

/**
 * The purchase flow with buttons only: Buy link, size, confirmation, phone number, delivery
 * location and option, and payment instructions. It works without the model, so customers can buy
 * when Gemini is unavailable.
 */
export function createPurchaseHandlers(deps: PurchaseDeps): Composer<BuchiContext> {
  const { catalog, customers, checkout, locations, landmarks, chat, farQuotes } = deps;
  const purchase = new Composer<BuchiContext>();

  purchase.command('start', async (ctx, next) => {
    const postId = postIdFromStartPayload(ctx.match);
    if (!postId || !ctx.from) return next();
    const opened = await catalog.openPost(postId);
    if (!opened) {
      await ctx.reply('ይህ ምርት አሁን አይገኝም / This product is no longer available.');
      return;
    }
    const buyer = buyerOf(ctx.from);
    await customers.identify(opened.shopId, buyer.telegramUserId, buyer.name);
    await customers.startSession(buyer.telegramUserId, opened.shopId, opened.product.id);
    await chat.productCard(buyer.telegramUserId, opened.product);
  });

  purchase.callbackQuery(new RegExp(`^size:${UUID}$`), async (ctx) => {
    const session = await customers.sessionOf(ctx.from.id);
    const forSale = session && (await catalog.variantForSale(session.shopId, ctx.match[1] ?? ''));
    await ctx.answerCallbackQuery();
    if (!forSale) {
      await ctx.reply(startAgain);
      return;
    }
    const { product, variant } = forSale;
    const chosen = `${product.title} · መጠን / size ${variant.size}`;
    const price = await checkout.unitPrice(session.shopId, buyerOf(ctx.from), variant.id);
    if (!price) {
      // The size waits in the cart while the customer agrees the price with the sales agent.
      await customers.rememberChosenVariant(ctx.from.id, variant.id);
      await ctx.reply(`${chosen}\n💬 ዋጋ ይንገሩኝ / Tell me your offer, and we will agree the price.`);
      return;
    }
    await ctx.reply(`${chosen} · ${formatBirr(price.toString())}`, {
      reply_markup: new InlineKeyboard()
        .text('✅ አረጋግጥ / Confirm', `buy:${variant.id}`)
        .text('ሰርዝ / Cancel', 'purchase:cancel'),
    });
  });

  purchase.callbackQuery(new RegExp(`^buy:${UUID}$`), async (ctx) => {
    const session = await customers.sessionOf(ctx.from.id);
    await ctx.answerCallbackQuery();
    if (!session) {
      await ctx.reply(startAgain);
      return;
    }
    await ctx.editMessageReplyMarkup();
    await replyWith(ctx, chat, () =>
      checkout.placeOrder(session.shopId, buyerOf(ctx.from), ctx.match[1] ?? ''),
    );
  });

  purchase.callbackQuery('purchase:cancel', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText('ተሰርዟል / Cancelled.');
  });

  purchase.on('message:contact', async (ctx) => {
    if (ctx.msg.contact.user_id !== ctx.from.id) {
      await ctx.reply('የራስዎን ስልክ ቁጥር ያጋሩ / Share your own phone number, please.');
      return;
    }
    const session = await customers.sessionOf(ctx.from.id);
    if (!session) {
      await ctx.reply(startAgain, { reply_markup: { remove_keyboard: true } });
      return;
    }
    await ctx.reply('አመሰግናለሁ / Thank you!', { reply_markup: { remove_keyboard: true } });
    await replyWith(ctx, chat, () =>
      checkout.completeWithPhone(
        session.shopId,
        buyerOf(ctx.from),
        ctx.msg.contact.phone_number,
        session.pendingVariantId,
      ),
    );
  });

  /** Continues an order only while the customer has a size waiting for its delivery choice. */
  const pendingOrder = async (telegramUserId: number) => {
    const session = await customers.sessionOf(telegramUserId);
    return session?.pendingVariantId
      ? { ...session, variantId: session.pendingVariantId }
      : undefined;
  };

  const choose = async (
    ctx: Context & { from: User },
    session: Session & { variantId: string },
    choice: PricedDeliveryType,
  ) =>
    replyWith(ctx, chat, () =>
      checkout.placeWithDelivery(session.shopId, buyerOf(ctx.from), session.variantId, choice),
    );

  /** Tells the customer the drivers are asked first, because pricing takes a model call. */
  const askDrivers = async (
    ctx: Context & { from: User },
    session: Session & { variantId: string },
  ) => {
    const result = await replyWith(ctx, chat, () =>
      checkout.requestFarQuote(session.shopId, buyerOf(ctx.from), session.variantId),
    );
    if (result?.status === 'quoting') await farQuotes.start(result.shopId, result.orderId);
  };

  const offerOptions = async (
    ctx: Context & { from: User },
    session: Session,
    pin: PinResult,
  ): Promise<void> => {
    if (pin.status === 'ask_for_pin') {
      await chat.askForPin(ctx.from.id, pinRequest(pin.reason));
      return;
    }
    await ctx.reply('📍 ተቀብያለሁ / Got your location.', { reply_markup: { remove_keyboard: true } });
    const quote = await checkout.deliveryOptions(
      session.shopId,
      buyerOf(ctx.from),
      pin.coordinates,
    );
    const { text, buttons } = deliveryChoice(quote);
    await ctx.reply(text, { reply_markup: oneButtonPerRow(buttons) });
  };

  purchase.on('message:location', async (ctx, next) => {
    const session = await pendingOrder(ctx.from.id);
    if (!session) return next();
    const { latitude, longitude } = ctx.msg.location;
    await offerOptions(ctx, session, checkPin({ latitude, longitude }));
  });

  /** The pin from the map picker Mini App, which Telegram delivers as a service message. */
  purchase.on('message:web_app_data', async (ctx, next) => {
    const session = await pendingOrder(ctx.from.id);
    if (!session) return next();
    const pin = coordinatesSchema.safeParse(parseJson(ctx.msg.web_app_data.data));
    if (!pin.success) {
      await chat.askForPin(ctx.from.id, pinRequest('no_coordinates'));
      return;
    }
    await offerOptions(ctx, session, checkPin(pin.data));
  });

  purchase.on('message:text', async (ctx, next) => {
    const session = await pendingOrder(ctx.from.id);
    if (!session) return next();
    if (ctx.msg.text === PICKUP_TEXT) {
      await ctx.reply('አመሰግናለሁ / Thank you!', { reply_markup: { remove_keyboard: true } });
      await choose(ctx, session, 'pickup');
      return;
    }
    const read = await locations.fromText(ctx.msg.text);
    if (read.status === 'not_a_location') return next();
    await offerOptions(ctx, session, read);
  });

  /** The customer confirmed the place the sales agent found for their landmark. */
  purchase.callbackQuery(CONFIRM_PLACE_DATA, async (ctx) => {
    const venue = ctx.callbackQuery.message?.venue;
    const session = await customers.sessionOf(ctx.from.id);
    await ctx.answerCallbackQuery();
    if (!venue || !session) {
      await ctx.reply(startAgain);
      return;
    }
    await ctx.editMessageReplyMarkup();
    const { latitude, longitude } = venue.location;
    const pin = checkPin({ latitude, longitude });
    if (pin.status === 'found') {
      const landmark = { name: venue.title, area: venue.address };
      await landmarks.confirm(session.shopId, landmark, pin.coordinates);
    }
    const pending = await pendingOrder(ctx.from.id);
    if (pending) await offerOptions(ctx, pending, pin);
    else await ctx.reply('📍 ተቀብያለሁ / Got your location.');
  });

  purchase.callbackQuery(/^deliver:/, async (ctx) => {
    const choice = deliveryChoiceCallbackSchema.safeParse(ctx.callbackQuery.data);
    const session = await pendingOrder(ctx.from.id);
    await ctx.answerCallbackQuery();
    if (!choice.success || !session) {
      await ctx.reply(startAgain);
      return;
    }
    // Removing the buttons first keeps a second tap from placing the order twice.
    await ctx.editMessageReplyMarkup();
    if (choice.data === 'far') await askDrivers(ctx, session);
    else await choose(ctx, session, choice.data);
  });

  return purchase;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

const startAgain = 'እባክዎ በቻናሉ ላይ ያለውን ቁልፍ እንደገና ይጫኑ / Tap the button on the channel post again.';

/** Sends the result of placing an order, or the reason it could not be placed, and returns it. */
async function replyWith<Step extends CheckoutStep>(
  ctx: Context & { from: User },
  chat: Pick<TelegramCustomerChat, 'orderStep'>,
  place: () => Promise<Step | undefined>,
): Promise<Step | undefined> {
  try {
    const result = await place();
    if (result) await chat.orderStep(ctx.from.id, result);
    return result;
  } catch (err) {
    if (err instanceof AppError && (err.code === 'CONFLICT' || err.code === 'NOT_FOUND')) {
      await ctx.reply(`ይቅርታ / Sorry: ${err.message}.`);
      return undefined;
    }
    throw err;
  }
}
