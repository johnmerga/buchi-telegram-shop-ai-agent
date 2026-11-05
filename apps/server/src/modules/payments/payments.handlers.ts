import { Composer } from 'grammy';
import type { Message } from 'grammy/types';
import type { BuchiContext } from '../../telegram/actor';
import type { CustomersService } from '../customers/customers.service';
import type { ImageIntake, IncomingImage } from './image-intake.service';
import type { PaymentReview, ReviewResult } from './payment-review.service';
import { reviewActionSchema } from './payments.schemas';

interface PaymentDeps {
  intake: ImageIntake;
  review: PaymentReview;
  customers: Pick<CustomersService, 'sessionOf'>;
}

const reviewAnswers: Record<ReviewResult, string> = {
  approved: 'Approved. The customer is told the payment is confirmed.',
  rejected: 'Rejected. The customer is asked to check the payment.',
  not_found: "Only this shop's owners can do this.",
  already_decided: 'This payment was already decided.',
};

/**
 * Customer images and the owner's payment review buttons. It runs after the conversation
 * handlers, so an image in a chat that an owner has taken over goes to the owner instead.
 */
export function createPaymentHandlers(deps: PaymentDeps): Composer<BuchiContext> {
  const { intake, review, customers } = deps;
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
    await ctx.reply(await intake.receive(session.shopId, ctx.from.id, image));
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
