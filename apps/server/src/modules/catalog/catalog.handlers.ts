import { Composer, InlineKeyboard } from 'grammy';
import type { BuchiContext } from '../../telegram/actor';
import type { CatalogService } from './catalog.service';

const PRODUCT_CHOICES = 8;
const ATTACH_PREFIX = 'photo:';

/**
 * Owners add product photos by sending them to the bot. The photo stays on Telegram's servers,
 * and the product keeps its `file_id`. The choice buttons reply to the photo, so the callback
 * reads the photo from the replied-to message and needs no stored state.
 */
export function createCatalogHandlers(catalog: CatalogService): Composer<BuchiContext> {
  const owners = new Composer<BuchiContext>();

  owners.on('message:photo', async (ctx) => {
    if (ctx.actor.role !== 'owner') return;
    const products = await catalog.recentProducts(ctx.actor.shopIds, PRODUCT_CHOICES);
    if (products.length === 0) {
      await ctx.reply('Add a product in the dashboard first, then send its photo.');
      return;
    }
    const keyboard = new InlineKeyboard();
    for (const product of products) {
      keyboard.text(product.title, `${ATTACH_PREFIX}${product.id}`).row();
    }
    await ctx.reply('ይህ ፎቶ የየትኛው ምርት ነው? / Which product is this photo for?', {
      reply_parameters: { message_id: ctx.msg.message_id },
      reply_markup: keyboard,
    });
  });

  owners.callbackQuery(new RegExp(`^${ATTACH_PREFIX}([0-9a-f-]{36})$`), async (ctx) => {
    const productId = ctx.match[1];
    const photo = ctx.callbackQuery.message?.reply_to_message?.photo?.at(-1);
    if (ctx.actor.role !== 'owner' || !productId || !photo) {
      await ctx.answerCallbackQuery({ text: 'Send the photo again, please.' });
      return;
    }
    const product = await catalog.attachPhoto(ctx.actor.shopIds, productId, photo.file_id);
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(`✅ ፎቶው ተጨምሯል / Photo added to ${product.title}`);
  });

  return owners;
}
