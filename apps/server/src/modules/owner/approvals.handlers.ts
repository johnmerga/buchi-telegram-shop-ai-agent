import { Composer } from 'grammy';
import type { ApprovalResult, OwnerApprovals } from '../../ai/approvals/owner-approvals.service';
import { approvalCallbackSchema } from '../../ai/approvals/approvals.schemas';
import type { BuchiContext } from '../../telegram/actor';

function answerFor(result: ApprovalResult): string {
  switch (result.status) {
    case 'approved':
      return result.result.status === 'error'
        ? `Approved, but it could not be done: ${result.result.error}`
        : 'Approved and done.';
    case 'declined':
      return 'Declined. Buchi will not do it.';
    case 'already_decided':
      return 'This was already decided.';
    case 'not_found':
      return "Only this shop's owners can do this.";
  }
}

/** The owners' **Approve** and **Decline** buttons on an action that Buchi held for them. */
export function createApprovalHandlers(
  approvals: Pick<OwnerApprovals, 'decide'>,
): Composer<BuchiContext> {
  const handlers = new Composer<BuchiContext>();

  handlers.callbackQuery(/^approval:/, async (ctx) => {
    const parsed = approvalCallbackSchema.safeParse(ctx.callbackQuery.data);
    const owner =
      ctx.actor.role === 'owner'
        ? { telegramUserId: ctx.actor.telegramUserId, shopIds: ctx.actor.shopIds }
        : undefined;
    const result: ApprovalResult =
      parsed.success && owner
        ? await approvals.decide(owner, parsed.data.decisionId, parsed.data.choice)
        : { status: 'not_found' };
    const text = answerFor(result);
    await ctx.answerCallbackQuery({ text });
    if (result.status === 'approved' || result.status === 'declined') {
      await ctx.editMessageReplyMarkup();
      await ctx.reply(text);
    }
  });

  return handlers;
}
