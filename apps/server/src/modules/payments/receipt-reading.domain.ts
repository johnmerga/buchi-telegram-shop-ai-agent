import { Money, type MoneyString } from '@buchi/shared';
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
  type KnownLayout,
  type ReceiptProvider,
} from './receipt-layouts.domain';

/** The design doc's threshold for R1. Below it, Buchi asks for a clearer screenshot. */
const MIN_CONFIDENCE = 0.7;

/** The Telebirr app's screens print only the receiver's first name. */
const FIRST_NAME_ONLY: KnownLayout[] = ['telebirr_app', 'telebirr_app_success'];

/** A receipt that code read: every field the later rules need is present and well formed. */
export interface ReadReceipt {
  provider: ReceiptProvider;
  txRef: string;
  /**
   * The Telebirr app's screen right after a payment prints the total with its charges, so it can
   * be a little more than what the shop received. The bank's page shows the amount itself.
   */
  amount: Money;
  receiver: PrintedReceiver;
  /** The Telebirr app prints only the receiver's first name, which R4 can only partly check. */
  receiverFirstNameOnly: boolean;
  paidAt: Date;
}

/** Why a readable receipt goes to the owner before any rule runs. */
export type ImplausibleReason = 'unparseable' | 'reference_date' | 'amount_total' | 'not_completed';

/** Why the transaction reference alone kept a receipt from being read. */
export type ReferenceProblem = Extract<ImplausibleReason, 'unparseable' | 'reference_date'>;

/** What code made of a receipt, before rules R3 to R6. */
export type Reading =
  | { status: 'read'; receipt: ReadReceipt }
  | { status: 'unreadable' }
  | { status: 'unknown_layout' }
  | { status: 'implausible'; reason: ImplausibleReason }
  /**
   * Every field read except the transaction reference, which a model can miscopy, such as one of
   * three zeros in a row. It is worth reading again, or asking the customer to type it.
   */
  | { status: 'bad_reference'; provider: ReceiptProvider; problem: ReferenceProblem };

const implausible = (reason: ImplausibleReason): Reading => ({ status: 'implausible', reason });

/**
 * R1 and R2 over what the model copied: the model only transcribes, and code reads each layout's
 * formats. A missing or unsure field asks for a clearer screenshot, while a confident field that
 * does not parse, or fields that contradict each other, go to the owner. Classification
 * confidence is `null` when the classifier was unavailable, and then the fields alone decide.
 * A reference the customer typed is not checked against the printed date again: asking once more
 * would get the same answer, so the bank's page and the rules decide instead.
 */
export function interpretReceipt(
  extraction: ReceiptExtraction,
  classificationConfidence: number | null,
  { referenceTyped = false }: { referenceTyped?: boolean } = {},
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
  const amount = parsePrintedAmount(printedAmount);
  const paidAt = parsePrintedTime(layout.value, printedTime);
  if (!amount || !paidAt) return implausible('unparseable');

  const status = confident(extraction.status);
  if (status !== undefined && !isCompleted(status)) return implausible('not_completed');
  const totals = checkTotals(amount, extraction);
  if (totals !== 'pass') return implausible(totals);

  // The reference comes last, so a receipt is read again for it only when nothing else is wrong.
  const txRef = parseReference(provider, printedRef);
  if (!txRef) return { status: 'bad_reference', provider, problem: 'unparseable' };
  if (provider === 'cbe_bank' && !referenceTyped && !cbeReferenceMatchesDate(txRef, paidAt)) {
    return { status: 'bad_reference', provider, problem: 'reference_date' };
  }

  const receiverFirstNameOnly = FIRST_NAME_ONLY.includes(layout.value);
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
  const printedCharges = [extraction.serviceCharge, extraction.vat, extraction.otherCharge].flatMap(
    (field) => confident(field) ?? [],
  );
  const total = parsePrintedAmount(printedTotal);
  const charges = printedCharges.map(parsePrintedAmount);
  const parsedCharges = charges.filter((charge) => charge !== undefined);
  if (!total || parsedCharges.length !== charges.length) return 'unparseable';
  return chargesAddUp(amount, parsedCharges, total) ? 'pass' : 'amount_total';
}

/** The extraction with a transaction reference read again or typed by the customer. */
export function withReference(extraction: ReceiptExtraction, reference: string): ReceiptExtraction {
  return { ...extraction, transactionRef: { value: reference, confidence: 1 } };
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

/** How often this order already asked for a clearer screenshot, and for the reference. */
export interface EarlierAsks {
  unreadable: number;
  reference: number;
}

/** The rules and decision for a receipt that code could not read as a payment. */
export function decideUnread(
  reading: Exclude<Reading, { status: 'read' }>,
  earlier: EarlierAsks,
): { rules: RuleResults | null; decision: Decision } {
  switch (reading.status) {
    case 'unreadable':
      return {
        rules: { r1: 'fail' },
        decision: decide({ stage: 'unreadable', earlierUnreadable: earlier.unreadable }),
      };
    case 'unknown_layout':
      return { rules: { r1: 'pass', r2: 'fail' }, decision: decide({ stage: 'unknown_layout' }) };
    case 'implausible':
      return { rules: null, decision: decide({ stage: 'implausible', reason: reading.reason }) };
    case 'bad_reference':
      return {
        rules: null,
        decision: decide({
          stage: 'bad_reference',
          problem: reading.problem,
          earlierAsks: earlier.reference,
        }),
      };
  }
}
