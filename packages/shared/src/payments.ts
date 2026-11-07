import { z } from 'zod';
import { moneySchema } from './money';
import { paymentProviderSchema } from './shops';

/** What the bank's public receipt page said about a transaction reference (layer 3). */
export const bankChecks = ['CONFIRMED', 'NOT_FOUND', 'MISMATCH', 'UNAVAILABLE'] as const;
export type BankCheck = (typeof bankChecks)[number];

const extractedFieldSchema = z.object({
  value: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});

/** What Gemini copied from a receipt, field by field as printed, with its confidence. */
export const receiptFieldsSchema = z.object({
  layout: extractedFieldSchema,
  transactionRef: extractedFieldSchema,
  amount: extractedFieldSchema,
  receiverName: extractedFieldSchema,
  receiverAccount: extractedFieldSchema,
  payerName: extractedFieldSchema,
  payerAccount: extractedFieldSchema,
  paidAt: extractedFieldSchema,
  status: extractedFieldSchema,
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
  /** A screenshot that Buchi rejected, which the customer reported as a mistake. */
  customerReported: z.boolean(),
});
export type PaymentReviewItem = z.infer<typeof paymentReviewItemSchema>;

export const paymentReviewActionSchema = z.enum(['approve', 'reject']);
export type PaymentReviewAction = z.infer<typeof paymentReviewActionSchema>;

export const paymentReviewResultSchema = z.object({ result: z.enum(['approved', 'rejected']) });

/** What became of a payment proof that no longer waits for the owner. */
export const paymentOutcomes = [
  'approved',
  'rejected',
  'asked_rest',
  'asked_full_amount',
  'asked_clearer',
  'asked_reference',
] as const;
export type PaymentOutcome = (typeof paymentOutcomes)[number];

/**
 * A payment proof that Buchi or the owner decided, for the owner's history. `amount` is what the
 * receipt or the bank's page showed, and is null when Buchi could not read it.
 */
export const paymentDecisionItemSchema = z.object({
  proofId: z.uuid(),
  orderReference: z.string(),
  customerName: z.string(),
  amount: moneySchema.nullable(),
  provider: paymentProviderSchema.nullable(),
  outcome: z.enum(paymentOutcomes),
  decidedBy: z.enum(['buchi', 'owner']),
  receivedAt: z.iso.datetime(),
  bankCheck: z.enum(bankChecks).nullable(),
  reasons: z.array(z.string()),
});
export type PaymentDecisionItem = z.infer<typeof paymentDecisionItemSchema>;
