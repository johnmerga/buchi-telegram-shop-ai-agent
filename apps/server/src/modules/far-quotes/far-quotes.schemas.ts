import { z } from 'zod';

const customerActions = ['confirm', 'decline'] as const;
const ownerActions = ['approve', 'pickup'] as const;
type FarQuoteAction = (typeof customerActions)[number] | (typeof ownerActions)[number];

/**
 * Telegram limits callback data to 64 bytes, so a button carries one ID: the order for the
 * customer's **Confirm** and **Decline**, and the quote for the owner's **Approve once** and
 * **Offer pickup**.
 */
export function farQuoteCallbackData(action: FarQuoteAction, id: string): string {
  return `farquote:${action}:${id}`;
}

export const farQuoteCallbackSchema = z
  .string()
  .transform((data) => data.split(':'))
  .pipe(z.tuple([z.literal('farquote'), z.enum([...customerActions, ...ownerActions]), z.uuid()]))
  .transform(([, action, id]) => ({ action, id }));
