import { orderReference } from '../../modules/orders/orders.domain';
import type { Button } from '../../modules/owner/owner.domain';
import { approvalCallbackData } from './approvals.schemas';

interface RequestFormat {
  title: string;
  /** The stored input fields the owner reads, with their labels. IDs other than orders are hidden. */
  fields: Record<string, string>;
}

const formats: Record<string, RequestFormat> = {
  extend_deadline: {
    title: '⏰ Extend the payment deadline again?',
    fields: { value: 'Minutes' },
  },
  propose_refund: { title: '💸 Refund the customer?', fields: { amount: 'Amount (birr)' } },
  propose_restock: { title: '📦 Restock?', fields: { quantity: 'Quantity' } },
  propose_bonus: { title: '🛵 Add a driver bonus?', fields: { bonus: 'Bonus (birr)' } },
  escalate: {
    title: '🙋 Take over this case? Approve, and the customer chat comes to you.',
    fields: { summary: 'Case', recommendation: 'Buchi recommends' },
  },
};

const common = { orderId: 'Order', reason: 'Why' };

/** The owner's message for a held action: what Buchi wants to do, and why. */
export function approvalRequest(request: {
  tool: string;
  proposed: Record<string, unknown>;
  agentReason: string | null;
}): string {
  const format = formats[request.tool] ?? { title: `Approve ${request.tool}?`, fields: {} };
  const labels: Record<string, string> = { ...format.fields, ...common };
  const values: Record<string, unknown> = { reason: request.agentReason, ...request.proposed };
  const lines = Object.entries(labels).flatMap(([key, label]) => {
    const value = values[key];
    if (typeof value !== 'string' && typeof value !== 'number') return [];
    const shown = key === 'orderId' ? orderReference(String(value)) : String(value);
    return [`${label}: ${shown}`];
  });
  return [`🤖 ${format.title}`, ...lines].join('\n');
}

export function approvalButtons(decisionId: string): Button[] {
  return [
    { text: '✅ Approve', data: approvalCallbackData('approve', decisionId) },
    { text: '✖️ Decline', data: approvalCallbackData('decline', decisionId) },
  ];
}

/** The same choices on a preview of the owner's own request. */
export function confirmButtons(decisionId: string): Button[] {
  return [
    { text: '✅ አረጋግጥ / Confirm', data: approvalCallbackData('approve', decisionId) },
    { text: '✖️ ሰርዝ / Cancel', data: approvalCallbackData('decline', decisionId) },
  ];
}
