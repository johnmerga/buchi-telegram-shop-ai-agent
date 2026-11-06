import { z } from 'zod';

const confidence = z.number().min(0).max(1);

/** What a customer's image shows, from the fast model. */
export const imageClassificationSchema = z.object({
  kind: z.enum(['receipt', 'product', 'other']),
  confidence,
});
export type ImageClassification = z.infer<typeof imageClassificationSchema>;

/** The receipt layouts Buchi knows. Code reads each one's date and reference formats. */
export const receiptLayouts = [
  'telebirr_app',
  'telebirr_web',
  'cbe_app',
  'cbe_web',
  'cbe_pdf',
  'unknown',
] as const;
export type ReceiptLayout = (typeof receiptLayouts)[number];

/** Text that the model copied from a receipt, or `null` when the receipt does not show it. */
const printed = z.object({
  value: z.string().trim().max(120).nullable(),
  confidence,
});

/**
 * What the smart model copied from a receipt, character for character. Code interprets every
 * value, and model output is untrusted, so anything that does not match this schema sends the
 * payment to owner review.
 */
export const receiptExtractionSchema = z.object({
  layout: z.object({ value: z.enum(receiptLayouts), confidence }),
  transactionRef: printed,
  amount: printed,
  serviceCharge: printed,
  vat: printed,
  totalAmount: printed,
  paidAt: printed,
  receiverName: printed,
  receiverAccount: printed,
  payerName: printed,
  payerAccount: printed,
  status: printed,
});
export type ReceiptExtraction = z.infer<typeof receiptExtractionSchema>;
export type PrintedField = ReceiptExtraction['amount'];

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
