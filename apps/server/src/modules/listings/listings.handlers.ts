import { Composer } from 'grammy';
import type { BuchiContext } from '../../telegram/actor';
import { inlineKeyboard } from '../../telegram/keyboards';
import { draftPreview, type DraftView } from './listings.domain';
import { listingCallbackSchema } from './listings.schemas';
import type { ListingService, PostResult } from './listings.service';

const replies = {
  unavailable: 'ይቅርታ / Sorry, I could not draft this now. Please send it again in a while.',
  edit: 'Reply to the draft with a new note, such as "Nike Air 40-43 ጥቁር 3400", or with prices only.',
  discarded: '🗑 Draft discarded.',
  gone: 'This draft is already posted or discarded.',
};

function postAnswer(result: PostResult): string {
  switch (result.status) {
    case 'posted':
      return `📤 Posted to your channel: ${result.title}`;
    case 'saved_only':
      return `✅ Saved ${result.title} in your inventory, but not posted: ${result.problem ?? ''}`;
    case 'needs_prices':
      return 'Reply to the draft with its prices first.';
    case 'not_found':
      return replies.gone;
  }
}

/**
 * Snap-to-list in the owner's chat: a photo with a note becomes a draft with **Post**, **Edit**,
 * and **Discard**, and a reply to the draft sets its prices or redrafts it. It serves owners of
 * one shop; a photo without a note keeps the attach-to-product flow.
 */
export function createListingHandlers(listings: ListingService): Composer<BuchiContext> {
  const owners = new Composer<BuchiContext>();
  const ownedShop = (ctx: BuchiContext) =>
    ctx.actor.role === 'owner' && ctx.actor.shopIds.length === 1 ? ctx.actor.shopIds[0] : undefined;

  owners.on('message:photo', async (ctx, next) => {
    const shopId = ownedShop(ctx);
    const photo = ctx.msg.photo.at(-1);
    if (!shopId || !photo) return next();
    const note = ctx.msg.caption?.trim();
    const album = ctx.msg.media_group_id;
    if (!note) {
      if (album && (await listings.addAlbumPhoto(shopId, album, photo.file_id))) return;
      return next();
    }
    const view = await listings.draft(shopId, note, { fileId: photo.file_id, mediaGroupId: album });
    if (!view) {
      await ctx.reply(replies.unavailable);
      return;
    }
    const { text, buttons } = draftPreview(view);
    const sent = await ctx.reply(text, { reply_markup: inlineKeyboard(buttons) });
    await listings.setPreview(shopId, view.id, {
      chatId: sent.chat.id,
      messageId: sent.message_id,
    });
  });

  owners.on('message:text', async (ctx, next) => {
    const shopId = ownedShop(ctx);
    const repliedTo = ctx.msg.reply_to_message;
    if (!shopId || !repliedTo) return next();
    const preview = { chatId: ctx.chat.id, messageId: repliedTo.message_id };
    const result = await listings.reply(shopId, preview, ctx.msg.text);
    if (result === undefined) return next();
    if (result === 'unavailable') {
      await ctx.reply(replies.unavailable);
      return;
    }
    await showDraft(ctx, preview, result);
  });

  owners.callbackQuery(/^listing:/, async (ctx) => {
    const parsed = listingCallbackSchema.safeParse(ctx.callbackQuery.data);
    const shopId = ownedShop(ctx);
    if (!parsed.success || !shopId) {
      await ctx.answerCallbackQuery({ text: "Only this shop's owner can do this." });
      return;
    }
    const { action, draftId } = parsed.data;
    if (action === 'edit') {
      await ctx.answerCallbackQuery({ text: replies.edit, show_alert: true });
      return;
    }
    const posted = action === 'post' ? await listings.post(shopId, draftId) : undefined;
    if (posted?.status === 'needs_prices') {
      await ctx.answerCallbackQuery({ text: postAnswer(posted), show_alert: true });
      return;
    }
    const discarded = action === 'discard' && (await listings.discard(shopId, draftId));
    const text = posted ? postAnswer(posted) : discarded ? replies.discarded : replies.gone;
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup();
    await ctx.reply(text);
  });

  return owners;
}

/** The draft message changes in place, so the owner can keep replying to the same message. */
async function showDraft(
  ctx: BuchiContext,
  preview: { chatId: number; messageId: number },
  view: DraftView,
): Promise<void> {
  const { text, buttons } = draftPreview(view);
  await ctx.api.editMessageText(preview.chatId, preview.messageId, text, {
    reply_markup: inlineKeyboard(buttons),
  });
}
