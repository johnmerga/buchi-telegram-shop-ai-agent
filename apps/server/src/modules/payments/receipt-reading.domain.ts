import { Money, type MoneyString, type PaymentProvider } from '@buchi/shared';
import type { PrintedReceiver } from '../../shared/accounts';
import { decide, type Decision, type RuleResults } from './payments.decision.domain';
import type { PrintedField, ReceiptExtraction } from './payments.schemas';
import {
  cbeReferenceMatchesDate,
  chargesAddUp,
  isCompleted,
  parsePrintedAmount,
  parsePrintedTime,
  parseReference,
  providerOf,
  type ReceiptProvider,
} from './receipt-layouts.domain';

/** The design doc's threshold for R1. Below it, Buchi asks for a clearer screenshot. */
const MIN_CONFIDENCE = 0.7;

/** A receipt that code read: every field the later rules need is present and well formed. */
export interface ReadReceipt {
  provider: PaymentProvider;
  txRef: string;
  amount: Money;
  receiver: PrintedReceiver;
  /** The Telebirr app prints only the receiver's first name, which R4 can only partly check. */
  receiverFirstNameOnly: boolean;
  paidAt: Date;
}

/** Why a readable receipt goes to the owner before any rule runs. */
export type ImplausibleReason = 'unparseable' | 'reference_date' | 'amount_total' | 'not_completed';

/** What code made of a receipt, before rules R3 to R6. */
export type Reading =
  | { status: 'read'; receipt: ReadReceipt }
  | { status: 'unreadable' }
  | { status: 'unknown_layout' }
  | { status: 'implausible'; reason: ImplausibleReason };

const implausible = (reason: ImplausibleReason): Reading => ({ status: 'implausible', reason });

/**
 * R1 and R2 over what the model copied: the model only transcribes, and code reads each layout's
 * formats. A missing or unsure field asks for a clearer screenshot, while a confident field that
 * does not parse, or fields that contradict each other, go to the owner. Classification
 * confidence is `null` when the classifier was unavailable, and then the fields alone decide.
 */
export function interpretReceipt(
  extraction: ReceiptExtraction,
  classificationConfidence: number | null,
): Reading {
  const unreadable: Reading = { status: 'unreadable' };
  if (classificationConfidence !== null && classificationConfidence < MIN_CONFIDENCE) {
    return unreadable;
  }
  const { layout } = extraction;
  if (layout.confidence < MIN_CONFIDENCE) return unreadable;
  if (layout.value === 'unknown') return { status: 'unknown_layout' };

  const printedRef = confident(extraction.transactionRef);
  const printedAmount = confident(extraction.amount);
  const printedTime = confident(extraction.paidAt);
  const receiver = {
    name: confident(extraction.receiverName) ?? null,
    account: confident(extraction.receiverAccount) ?? null,
  };
  if (!printedRef || !printedAmount || !printedTime) return unreadable;
  if (receiver.name === null && receiver.account === null) return unreadable;

  const provider = providerOf(layout.value);
  const txRef = parseReference(provider, printedRef);
  const amount = parsePrintedAmount(printedAmount);
  const paidAt = parsePrintedTime(layout.value, printedTime);
  if (!txRef || !amount || !paidAt) return implausible('unparseable');

  const status = confident(extraction.status);
  if (status !== undefined && !isCompleted(status)) return implausible('not_completed');
  if (provider === 'cbe_bank' && !cbeReferenceMatchesDate(txRef, paidAt)) {
    return implausible('reference_date');
  }
  const totals = checkTotals(amount, extraction);
  if (totals !== 'pass') return implausible(totals);

  const receiverFirstNameOnly = layout.value === 'telebirr_app';
  return {
    status: 'read',
    receipt: { provider, txRef, amount, receiver, receiverFirstNameOnly, paidAt },
  };
}

/** An edited amount usually leaves the printed total as it was. */
function checkTotals(
  amount: Money,
  extraction: ReceiptExtraction,
): 'pass' | 'unparseable' | 'amount_total' {
  const printedTotal = confident(extraction.totalAmount);
  if (printedTotal === undefined) return 'pass';
  const printedCharges = [extraction.serviceCharge, extraction.vat].flatMap(
    (field) => confident(field) ?? [],
  );
  const total = parsePrintedAmount(printedTotal);
  const charges = printedCharges.map(parsePrintedAmount);
  const parsedCharges = charges.filter((charge) => charge !== undefined);
  if (!total || parsedCharges.length !== charges.length) return 'unparseable';
  return chargesAddUp(amount, parsedCharges, total) ? 'pass' : 'amount_total';
}

function confident(field: PrintedField): string | undefined {
  return field.value && field.confidence >= MIN_CONFIDENCE ? field.value : undefined;
}

/** A receipt as the provider's own page shows it. The time is as printed. */
interface BankPage {
  txRef: string;
  amount: MoneyString;
  receiver: PrintedReceiver;
  completed: boolean;
  paidAt: string | null;
}

/** The layout that each provider's receipt page prints, for its date format. */
const pageLayouts = { telebirr: 'telebirr_web', cbe_bank: 'cbe_pdf' } as const;

/**
 * A receipt from the provider's own page, which a customer's link pointed to. The page is the
 * bank's record, so only its format and status are checked here.
 */
export function readBankPage(provider: ReceiptProvider, page: BankPage): Reading {
  if (!page.completed) return implausible('not_completed');
  const paidAt =
    page.paidAt === null ? undefined : parsePrintedTime(pageLayouts[provider], page.paidAt);
  if (!paidAt) return implausible('unparseable');
  return {
    status: 'read',
    receipt: {
      provider,
      txRef: page.txRef.toUpperCase(),
      amount: Money.of(page.amount),
      receiver: page.receiver,
      receiverFirstNameOnly: false,
      paidAt,
    },
  };
}

/** The rules and decision for a receipt that code could not read as a payment. */
export function decideUnread(
  reading: Exclude<Reading, { status: 'read' }>,
  earlierUnreadable: number,
): { rules: RuleResults | null; decision: Decision } {
  switch (reading.status) {
    case 'unreadable':
      return {
        rules: { r1: 'fail' },
        decision: decide({ stage: 'unreadable', earlierUnreadable }),
      };
    case 'unknown_layout':
      return { rules: { r1: 'pass', r2: 'fail' }, decision: decide({ stage: 'unknown_layout' }) };
    case 'implausible':
      return { rules: null, decision: decide({ stage: 'implausible', reason: reading.reason }) };
  }
}
