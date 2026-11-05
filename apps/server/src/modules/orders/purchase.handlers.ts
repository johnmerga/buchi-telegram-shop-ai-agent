import { formatBirr } from '@buchi/shared';
import { Composer, InlineKeyboard, Keyboard, type Context } from 'grammy';
import type { User } from 'grammy/types';
import { AppError } from '../../shared/errors';
import type { BuchiContext } from '../../telegram/actor';
import { availableSizes } from '../catalog/catalog.domain';
import type { CatalogService, ProductWithVariants } from '../catalog/catalog.service';
import { postIdFromStartPayload } from '../catalog/catalog.domain';
import type { CustomersService } from '../customers/customers.service';
import type { CheckoutService, PlaceOrderResult } from './checkout.service';

const UUID = '([0-9a-f-]{36})';

export interface PurchaseDeps {
  catalog: CatalogService;
  customers: CustomersService;
  checkout: CheckoutService;
}

const buyerOf = (from: User) => ({
  telegramUserId: from.id,
  name: [from.first_name, from.last_name].filter(Boolean).join(' '),
});

/**
 * The purchase flow with buttons only: Buy link, size, confirmation, phone number, and payment
 * instructions. It works without the model, so customers can buy when Gemini is unavailable.
 */
export function createPurchaseHandlers(deps: PurchaseDeps): Composer<BuchiContext> {
  const { catalog, customers, checkout } = deps;
  const purchase = new Composer<BuchiContext>();

  purchase.command('start', async (ctx, next) => {
    const postId = postIdFromStartPayload(ctx.match);
    if (!postId || !ctx.from) return next();
    const opened = await catalog.openPost(postId);
    if (!opened) {
      await ctx.reply('ይህ ምርት አሁን አይገኝም / This product is no longer available.');
      return;
    }
    await customers.identify(opened.shopId, ctx.from.id, buyerOf(ctx.from).name);
    await customers.startSession(ctx.from.id, opened.shopId);
    await sendProductCard(ctx, opened.product);
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
      `${product.title} · መጠን / size ${variant.size} · ${formatBirr(product.price)}\nPickup at the shop.`,
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

  return purchase;
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
