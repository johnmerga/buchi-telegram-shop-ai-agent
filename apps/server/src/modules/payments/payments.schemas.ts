import { moneySchema } from '@buchi/shared';
import { z } from 'zod';

const confidence = z.number().min(0).max(1);

/** What a customer's image shows, from the fast model. */
export const imageClassificationSchema = z.object({
  kind: z.enum(['receipt', 'product', 'other']),
  confidence,
});
export type ImageClassification = z.infer<typeof imageClassificationSchema>;

/** A field that the model read from a receipt, or `null` when the receipt does not show it. */
const field = <T extends z.ZodType>(value: T) => z.object({ value: value.nullable(), confidence });

/**
 * The receipt fields from the smart model. Model output is untrusted, so anything that does not
 * match this schema sends the payment to owner review.
 */
export const receiptExtractionSchema = z.object({
  provider: field(z.enum(['telebirr', 'cbe_birr', 'cbe_bank', 'other'])),
  transactionRef: field(z.string().trim().min(4).max(40)),
  amount: field(moneySchema),
  receiverName: field(z.string().trim().min(1).max(120)),
  receiverAccount: field(z.string().trim().min(4).max(40)),
  payerName: field(z.string().trim().min(1).max(120)),
  payerAccount: field(z.string().trim().min(4).max(40)),
  /** Local Addis Ababa time as the receipt prints it, such as "2026-11-05T14:30:00". */
  paidAt: field(z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/)),
});
export type ReceiptExtraction = z.infer<typeof receiptExtractionSchema>;

const REVIEW_PREFIX = 'payment';

export type ReviewAction = 'approve' | 'reject';

/** Telegram limits callback data to 64 bytes, so a review button carries only the proof ID. */
export function reviewCallbackData(action: ReviewAction, proofId: string): string {
  return `${REVIEW_PREFIX}:${action}:${proofId}`;
}

/** The data of an **Approve** or **Reject** button, as `reviewCallbackData` writes it. */
export const reviewActionSchema = z
  .string()
  .transform((data) => {
    const [prefix, action, proofId] = data.split(':');
    return { prefix, action, proofId };
  })
  .pipe(
    z.object({
      prefix: z.literal(REVIEW_PREFIX),
      action: z.enum(['approve', 'reject']),
      proofId: z.uuid(),
    }),
  );

const REPORT_PREFIX = 'payreport';

/**
 * The customer's **Report a problem** button under a rejected payment carries the order ID, which
 * finds the order in whichever shop it was placed.
 */
export function reportCallbackData(orderId: string): string {
  return `${REPORT_PREFIX}:${orderId}`;
}

/** The order ID of a **Report a problem** button, as `reportCallbackData` writes it. */
export const reportCallbackSchema = z
  .string()
  .transform((data) => {
    const [prefix, orderId] = data.split(':');
    return { prefix, orderId };
  })
  .pipe(z.object({ prefix: z.literal(REPORT_PREFIX), orderId: z.uuid() }));
