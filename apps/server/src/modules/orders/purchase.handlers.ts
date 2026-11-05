import { formatBirr } from '@buchi/shared';
import { Composer, InlineKeyboard, Keyboard, type Context } from 'grammy';
import type { User } from 'grammy/types';
import { AppError } from '../../shared/errors';
import type { BuchiContext } from '../../telegram/actor';
import { availableSizes } from '../catalog/catalog.domain';
import type { CatalogService, ProductWithVariants } from '../catalog/catalog.service';
import { postIdFromStartPayload } from '../catalog/catalog.domain';
import type { CustomersService } from '../customers/customers.service';
import type { PricedDeliveryType } from '../delivery/fees.domain';
import { checkPin, type PinResult } from '../delivery/location.domain';
import type { LocationService } from '../delivery/location.service';
import type { Button } from '../owner/owner.domain';
import type { ConversationService } from '../owner/conversations.service';
import type { CheckoutService, PlaceOrderResult } from './checkout.service';
import { deliveryChoice, pinRequest } from './delivery-choice.domain';
import { deliveryChoiceCallbackSchema } from './orders.schemas';

const UUID = '([0-9a-f-]{36})';

export interface PurchaseDeps {
  catalog: CatalogService;
  customers: CustomersService;
  checkout: CheckoutService;
  conversations: Pick<ConversationService, 'requestPrice'>;
  locations: Pick<LocationService, 'fromText'>;
}

type Session = NonNullable<Awaited<ReturnType<CustomersService['sessionOf']>>>;

const PICKUP_TEXT = '🏪 ከሱቁ እወስዳለሁ / I will pick up at the shop';

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
  const { catalog, customers, checkout, conversations, locations } = deps;
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
    await customers.startSession(buyer.telegramUserId, opened.shopId);
    await sendProductCard(ctx, opened.product);
    if (opened.product.pricingMode === 'negotiable') {
      await conversations.requestPrice(opened.shopId, buyer, opened.product.title);
    }
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
    await ctx.reply(
      `${product.title} · መጠን / size ${variant.size} · ${formatBirr(product.price)}`,
      {
        reply_markup: new InlineKeyboard()
          .text('✅ አረጋግጥ / Confirm', `buy:${variant.id}`)
          .text('ሰርዝ / Cancel', 'purchase:cancel'),
      },
    );
  });

  purchase.callbackQuery(new RegExp(`^buy:${UUID}$`), async (ctx) => {
    const session = await customers.sessionOf(ctx.from.id);
    await ctx.answerCallbackQuery();
    if (!session) {
      await ctx.reply(startAgain);
      return;
    }
    await ctx.editMessageReplyMarkup();
    await replyWith(ctx, () =>
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
    await replyWith(ctx, () =>
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
    replyWith(ctx, () =>
      checkout.placeWithDelivery(session.shopId, buyerOf(ctx.from), session.variantId, choice),
    );

  const offerOptions = async (
    ctx: Context & { from: User },
    session: Session,
    pin: PinResult,
  ): Promise<void> => {
    if (pin.status === 'ask_for_pin') {
      await ctx.reply(pinRequest(pin.reason), { reply_markup: locationKeyboard() });
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
    await choose(ctx, session, choice.data);
  });

  return purchase;
}

function locationKeyboard(): Keyboard {
  return new Keyboard()
    .requestLocation('📍 ቦታ አጋራ / Share location')
    .row()
    .text(PICKUP_TEXT)
    .oneTime()
    .resized();
}

function oneButtonPerRow(buttons: Button[]): InlineKeyboard {
  return InlineKeyboard.from(
    buttons.map((button) => [InlineKeyboard.text(button.text, button.data)]),
  );
}

const startAgain = 'እባክዎ በቻናሉ ላይ ያለውን ቁልፍ እንደገና ይጫኑ / Tap the button on the channel post again.';

async function sendProductCard(ctx: Context, product: ProductWithVariants): Promise<void> {
  const lines = [product.title, product.description].filter((line) => line !== '');
  if (product.pricingMode === 'negotiable') {
    lines.push('ባለቤቱ ዋጋውን ይነግርዎታል / The shop will send you the price here.');
    await sendCard(ctx, product, lines.join('\n\n'));
    return;
  }

  const sizes = availableSizes(product.variants);
  if (sizes.length === 0) {
    lines.push('ተሸጦ አልቋል / Sold out.');
    await sendCard(ctx, product, lines.join('\n\n'));
    return;
  }

  lines.push(`ዋጋ / Price: ${formatBirr(product.price)}`, 'መጠን ይምረጡ / Choose your size:');
  const keyboard = new InlineKeyboard();
  for (const variant of product.variants.filter((v) => v.stock > v.reserved)) {
    keyboard.text(
      variant.color ? `${variant.size} ${variant.color}` : variant.size,
      `size:${variant.id}`,
    );
  }
  await sendCard(ctx, product, lines.join('\n\n'), keyboard);
}

async function sendCard(
  ctx: Context,
  product: ProductWithVariants,
  text: string,
  keyboard?: InlineKeyboard,
): Promise<void> {
  const markup = keyboard ? { reply_markup: keyboard } : {};
  const photo = product.photoFileIds[0];
  if (photo) await ctx.replyWithPhoto(photo, { caption: text, ...markup });
  else await ctx.reply(text, markup);
}

/** Sends the result of placing an order, or the reason it could not be placed. */
async function replyWith(
  ctx: Context,
  place: () => Promise<PlaceOrderResult | undefined>,
): Promise<void> {
  try {
    const result = await place();
    if (result?.status === 'needs_phone') {
      await ctx.reply('ትዕዛዙን ለመጨረስ ስልክ ቁጥርዎን ያጋሩ / Share your phone number to finish the order.', {
        reply_markup: new Keyboard()
          .requestContact('📱 ስልክ ቁጥር አጋራ / Share phone number')
          .oneTime()
          .resized(),
      });
    } else if (result?.status === 'needs_location') {
      await ctx.reply(
        '📍 የት እናድርስ? / Where should we deliver? Share your location, or paste a Google Maps link.',
        { reply_markup: locationKeyboard() },
      );
    } else if (result?.status === 'placed') {
      await ctx.reply(result.instructions);
    }
  } catch (err) {
    if (err instanceof AppError && (err.code === 'CONFLICT' || err.code === 'NOT_FOUND')) {
      await ctx.reply(`ይቅርታ / Sorry: ${err.message}.`);
      return;
    }
    throw err;
  }
}
