import { describe, expect, it } from 'vitest';
import { approvalButtons, approvalRequest, confirmButtons } from './approvals.domain';
import { approvalCallbackSchema } from './approvals.schemas';

const orderId = '3f2a9c00-0000-4000-8000-000000000001';
const decisionId = 'd0000000-0000-4000-8000-000000000001';

describe('approvalRequest', () => {
  it('names the action, the order, the amount, and the reason', () => {
    const text = approvalRequest({
      tool: 'propose_refund',
      proposed: { orderId, amount: '3500.00', reason: 'Size 43 is sold out' },
      agentReason: null,
    });
    expect(text).toBe(
      [
        '🤖 💸 Refund the customer?',
        'Amount (birr): 3500.00',
        'Order: #3F2A9C',
        'Why: Size 43 is sold out',
      ].join('\n'),
    );
  });

  it("uses the guard's reason when the input has none, and hides IDs other than orders", () => {
    const text = approvalRequest({
      tool: 'propose_bonus',
      proposed: { orderId, bonus: 40 },
      agentReason: 'Nobody took the job',
    });
    expect(text).toContain('Bonus (birr): 40');
    expect(text).toContain('Why: Nobody took the job');

    const restock = approvalRequest({
      tool: 'propose_restock',
      proposed: { variantId: orderId, quantity: 12, reason: '10 waiting' },
      agentReason: null,
    });
    expect(restock).not.toContain(orderId);
    expect(restock).toContain('Quantity: 12');
  });

  it('still asks about a tool it has no format for', () => {
    expect(approvalRequest({ tool: 'new_tool', proposed: {}, agentReason: null })).toBe(
      '🤖 Approve new_tool?',
    );
  });
});

describe('approval buttons', () => {
  it('carry a choice and the decision that the callback schema reads back', () => {
    const [approve, decline] = approvalButtons(decisionId);
    expect(approvalCallbackSchema.parse(approve?.data)).toMatchObject({
      choice: 'approve',
      decisionId,
    });
    expect(approvalCallbackSchema.parse(decline?.data)).toMatchObject({ choice: 'decline' });
  });

  it('read the same on a preview with Confirm and Cancel', () => {
    const [confirm, cancel] = confirmButtons(decisionId);
    expect(confirm?.text).toContain('Confirm');
    expect(approvalCallbackSchema.parse(confirm?.data)).toMatchObject({ choice: 'approve' });
    expect(approvalCallbackSchema.parse(cancel?.data)).toMatchObject({ choice: 'decline' });
  });

  it('rejects data of other buttons', () => {
    expect(approvalCallbackSchema.safeParse(`approval:maybe:${decisionId}`).success).toBe(false);
    expect(approvalCallbackSchema.safeParse(`job:accept:${decisionId}`).success).toBe(false);
  });
});
