import { Composer } from 'grammy';
import type { Message } from 'grammy/types';
import type { BuchiContext } from '../../telegram/actor';
import type { TelegramCustomerChat } from '../../telegram/customer-chat';
import { inlineKeyboard } from '../../telegram/keyboards';
import type { CustomersService } from '../customers/customers.service';
import type { ImageIntake, IncomingImage } from './image-intake.service';
import { reportNotAvailable, reportReceived } from './payment-messages.domain';
import type { PaymentReports } from './payment-reports.service';
import type { PaymentReview, ReviewResult } from './payment-review.service';
import { reportCallbackSchema, reviewActionSchema } from './payments.schemas';
import { receiptLinkIn } from './receipt-links.domain';
import type { ReceiptLinks } from './receipt-links.service';

interface PaymentDeps {
  intake: ImageIntake;
  links: ReceiptLinks;
  review: PaymentReview;
  reports: Pick<PaymentReports, 'report'>;
  customers: Pick<CustomersService, 'sessionOf'>;
  chat: Pick<TelegramCustomerChat, 'photoSearch'>;
}

const reviewAnswers: Record<ReviewResult, string> = {
  approved: 'Approved. The customer is told the payment is confirmed.',
  rejected: 'Rejected. The customer is told the order is closed.',
  out_of_stock:
    'The item sold out after the order was closed. Restock it and approve, or reject and refund the customer.',
  not_found: "Only this shop's owners can do this.",
  already_decided: 'This payment was already decided.',
};

/**
 * Customer images, receipt links, and the owner's payment review buttons. It runs after the
 * conversation handlers, so a message in a chat that an owner has taken over goes to the owner.
 */
export function createPaymentHandlers(deps: PaymentDeps): Composer<BuchiContext> {
  const { intake, links, review, reports, customers, chat } = deps;
  const handlers = new Composer<BuchiContext>();

  handlers.on(['message:photo', 'message:document'], async (ctx, next) => {
    const image = incomingImage(ctx.msg);
    if (!image) return next();
    const session = await customers.sessionOf(ctx.from.id);
    if (!session) {
      if (ctx.actor.role === 'owner') return next();
      await ctx.reply('ሰላም! Tap Buy on a channel post to start an order.');
      return;
    }
    const reply = await intake.receive(session.shopId, ctx.from.id, image);
    if (reply.kind === 'photo_search') return chat.photoSearch(ctx.from.id, reply.result);
    const markup = reply.buttons.length > 0 ? { reply_markup: inlineKeyboard(reply.buttons) } : {};
    await ctx.reply(reply.text, markup);
  });

  handlers.callbackQuery(/^payreport:/, async (ctx) => {
    const button = reportCallbackSchema.safeParse(ctx.callbackQuery.data);
    const reported = button.success && (await reports.report(ctx.from.id, button.data.orderId));
    await ctx.answerCallbackQuery({ text: reported ? reportReceived : reportNotAvailable });
    if (reported) await ctx.editMessageReplyMarkup();
  });

  handlers.on('message:text', async (ctx, next) => {
    const link = receiptLinkIn(ctx.msg.text);
    if (!link) return next();
    const session = await customers.sessionOf(ctx.from.id);
    const ownShop = ctx.actor.role === 'owner' && ctx.actor.shopIds.includes(session?.shopId ?? '');
    if (!session || ownShop) return next();
    const message = { chatId: ctx.msg.chat.id, messageId: ctx.msg.message_id };
    const reply = await links.receive(session.shopId, ctx.from.id, link, message);
    const markup = reply.buttons.length > 0 ? { reply_markup: inlineKeyboard(reply.buttons) } : {};
    await ctx.reply(reply.text, markup);
  });

  handlers.callbackQuery(/^payment:/, async (ctx) => {
    const action = reviewActionSchema.safeParse(ctx.callbackQuery.data);
    const shopIds = ctx.actor.role === 'owner' ? ctx.actor.shopIds : [];
    const result = action.success
      ? await review.decide(shopIds, action.data.proofId, action.data.action)
      : 'not_found';
    await ctx.answerCallbackQuery({ text: reviewAnswers[result] });
    if (result === 'approved' || result === 'rejected') await ctx.editMessageReplyMarkup();
  });

  return handlers;
}

/** The largest size of a photo, or a file sent as a document if it is an image. */
function incomingImage(message: Message): IncomingImage | undefined {
  const ref = { chatId: message.chat.id, messageId: message.message_id };
  const photo = message.photo?.at(-1);
  if (photo) return { fileId: photo.file_id, mimeType: 'image/jpeg', message: ref };
  const document = message.document;
  if (document?.mime_type?.startsWith('image/')) {
    return { fileId: document.file_id, mimeType: document.mime_type, message: ref };
  }
  return undefined;
}
