import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Money, moneySchema, type PaymentAccount } from '@buchi/shared';
import type { LanguageModel } from '@buchi/server/ai/language-model';
import {
  decide,
  type CheckedRules,
  type Decision,
} from '@buchi/server/modules/payments/payments.decision.domain';
import {
  checkAmount,
  checkTime,
  matchingAccount,
} from '@buchi/server/modules/payments/payments.domain';
import {
  receiptLayouts,
  type ReceiptExtraction,
} from '@buchi/server/modules/payments/payments.schemas';
import { ReceiptReader } from '@buchi/server/modules/payments/receipt-reader.service';
import {
  parsePrintedAmount,
  parsePrintedTime,
  parseReference,
  providerOf,
} from '@buchi/server/modules/payments/receipt-layouts.domain';
import { decideUnread, type Reading } from '@buchi/server/modules/payments/receipt-reading.domain';
import { readScreenshot } from '@buchi/server/modules/payments/screenshot-reading';
import { pino } from 'pino';
import { z } from 'zod';
import { defineSuite, type Suite } from '../harness/suite';

/** The evaluation shop's accounts, which the synthetic receipts pay into or miss on purpose. */
const SHOP_ACCOUNTS: PaymentAccount[] = [
  { provider: 'telebirr', accountName: 'Liya Bekele Tadesse', accountNumber: '0911223344' },
  { provider: 'cbe_bank', accountName: 'Meron Alemu Kebede', accountNumber: '1000234561234' },
];

const imagesDir = fileURLToPath(new URL('../datasets/receipts/', import.meta.url));

const input = z.strictObject({
  /** A file in `evals/datasets/receipts/`, drawn by `scripts/receipt-images.ts`. */
  image: z.string().regex(/^[a-z0-9-]+\.jpg$/),
  orderTotal: moneySchema,
  orderPlacedAt: z.iso.datetime(),
  /** References that other orders already claimed, for R6. */
  usedReferences: z.array(z.string()),
});

const fieldsSchema = z.strictObject({
  transactionRef: z.string(),
  amount: moneySchema,
  paidAt: z.iso.datetime(),
  receiverName: z.string(),
});
type Fields = z.output<typeof fieldsSchema>;

const expected = z.strictObject({
  layout: z.enum(receiptLayouts),
  /** What code reads from the printed text; null for a layout Buchi does not know. */
  fields: fieldsSchema.nullable(),
  /** The outcome and its first reason, such as "review:over_limit" or "approve". */
  decision: z.string(),
});

interface Actual {
  layout: string | null;
  /** Each field as code read it, or null when it did not parse. */
  fields: Record<keyof Fields, string | null> | null;
  decision: string;
}

/**
 * The receipt reader on synthetic screenshots of the known layouts, edited copies, and an
 * unknown layout: the model copies the text, code reads it, a reference that does not fit is
 * copied once more, and the rules decide offline, as when the bank's page is unavailable.
 */
export function receiptsSuite(): Suite {
  const logger = pino({ level: 'silent' });

  async function run(testCase: z.output<typeof input>, model: LanguageModel): Promise<Actual> {
    const data = (await readFile(`${imagesDir}${testCase.image}`)).toString('base64');
    const reader = new ReceiptReader(model, logger);
    // Classification is a separate step, so the extraction alone decides here.
    const read = await readScreenshot(reader, { mimeType: 'image/jpeg', data }, null);
    if (!read) return { layout: null, fields: null, decision: 'review:extraction_failed' };
    const { extraction, reading } = read;
    return {
      layout: extraction.layout.value,
      fields: fieldsOf(extraction),
      decision: label(decisionOf(reading, testCase)),
    };
  }

  return defineSuite({
    name: 'receipts',
    dataset: 'receipts.jsonl',
    input,
    expected,
    metrics: {
      layoutMatch: { atLeast: 0.9 },
      fieldAccuracy: { atLeast: 0.9 },
      decisionMatch: { atLeast: 0.85 },
      wrongApproval: { atMost: 0 },
    },
    run,
    score: (actual, { expected: want }) => ({
      layoutMatch: actual.layout === want.layout ? 1 : 0,
      fieldAccuracy: fieldScore(actual, want.fields),
      decisionMatch: actual.decision === want.decision ? 1 : 0,
      wrongApproval: actual.decision === 'approve' && want.decision !== 'approve' ? 1 : 0,
    }),
  });
}

/** Each field through the same code that payment verification uses, for the extracted layout. */
function fieldsOf(extraction: ReceiptExtraction): Actual['fields'] {
  const layout = extraction.layout.value;
  if (layout === 'unknown') return null;
  const printed = (field: keyof ReceiptExtraction) => extraction[field].value ?? '';
  return {
    transactionRef: parseReference(providerOf(layout), printed('transactionRef')) ?? null,
    amount: parsePrintedAmount(printed('amount'))?.toString() ?? null,
    paidAt: parsePrintedTime(layout, printed('paidAt'))?.toISOString() ?? null,
    receiverName: extraction.receiverName.value,
  };
}

/** The decision for one order, with the bank's page unavailable and a payer without history. */
function decisionOf(reading: Reading, testCase: z.output<typeof input>): Decision {
  if (reading.status !== 'read')
    return decideUnread(reading, { unreadable: 0, reference: 0 }).decision;
  const { receipt } = reading;
  const due = Money.of(testCase.orderTotal);
  const rules: CheckedRules = {
    r1: 'pass',
    r2: 'pass',
    r3: checkAmount(receipt.amount, due),
    r4: matchingAccount(receipt, SHOP_ACCOUNTS) ? 'pass' : 'fail',
    r5: checkTime(receipt.paidAt, new Date(testCase.orderPlacedAt)),
    r6: testCase.usedReferences.includes(receipt.txRef) ? 'fail' : 'pass',
  };
  return decide({
    stage: 'checked',
    rules,
    bank: 'UNAVAILABLE',
    paid: receipt.amount,
    due,
    payerHighRisk: false,
    receiverFirstNameOnly: receipt.receiverFirstNameOnly,
    referenceTyped: false,
  });
}

function label(decision: Decision): string {
  switch (decision.outcome) {
    case 'review':
      return `review:${decision.reason}`;
    case 'reject':
      return `reject:${decision.reasons[0] ?? ''}`;
    default:
      return decision.outcome;
  }
}

/** The share of expected fields that code read right. An unknown layout has none to read. */
function fieldScore(actual: Actual, want: Fields | null): number {
  if (want === null) return actual.fields === null ? 1 : 0;
  if (actual.fields === null) return 0;
  const got = actual.fields;
  const checks = [
    got.transactionRef === want.transactionRef,
    got.amount !== null && Money.of(got.amount).compare(Money.of(want.amount)) === 0,
    got.paidAt === new Date(want.paidAt).toISOString(),
    words(got.receiverName) === words(want.receiverName),
  ];
  return checks.filter(Boolean).length / checks.length;
}

/** Names compare by their words, because a wrapped name may come back with a line break. */
function words(name: string | null): string {
  return (name ?? '').toLowerCase().split(/\s+/).filter(Boolean).join(' ');
}
