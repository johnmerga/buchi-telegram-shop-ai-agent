import { z } from 'zod';
import { moneySchema } from './money';

/** What the bank's public receipt page said about a transaction reference (layer 3). */
export const bankChecks = ['CONFIRMED', 'NOT_FOUND', 'MISMATCH', 'UNAVAILABLE'] as const;
export type BankCheck = (typeof bankChecks)[number];

const extractedFieldSchema = z.object({
  value: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});

/** What Gemini read from a receipt, field by field, with its confidence. */
export const receiptFieldsSchema = z.object({
  provider: extractedFieldSchema,
  transactionRef: extractedFieldSchema,
  amount: extractedFieldSchema,
  receiverName: extractedFieldSchema,
  receiverAccount: extractedFieldSchema,
  payerName: extractedFieldSchema,
  payerAccount: extractedFieldSchema,
  paidAt: extractedFieldSchema,
});
export type ReceiptFields = z.infer<typeof receiptFieldsSchema>;

/**
 * A payment screenshot that waits for the owner. `rules` holds each rule's result, such as
 * `{ r1: 'pass', r3: 'underpaid' }`; `extraction` is null when Gemini could not read it.
 */
export const paymentReviewItemSchema = z.object({
  proofId: z.uuid(),
  orderId: z.uuid(),
  orderReference: z.string(),
  customerName: z.string(),
  orderTotal: moneySchema,
  receivedAt: z.iso.datetime(),
  extraction: receiptFieldsSchema.nullable(),
  rules: z.record(z.string(), z.string()),
  bankCheck: z.enum(bankChecks).nullable(),
  reasons: z.array(z.string()),
  payerHighRisk: z.boolean(),
});
export type PaymentReviewItem = z.infer<typeof paymentReviewItemSchema>;

export const paymentReviewActionSchema = z.enum(['approve', 'reject']);
export type PaymentReviewAction = z.infer<typeof paymentReviewActionSchema>;

export const paymentReviewResultSchema = z.object({ result: z.enum(['approved', 'rejected']) });
