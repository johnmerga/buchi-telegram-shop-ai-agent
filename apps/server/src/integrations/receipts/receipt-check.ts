import { Money, moneySchema, type BankCheck, type MoneyString } from '@buchi/shared';
import { z } from 'zod';
import { receiverMatches, type KnownAccount } from '../../shared/accounts';

/** What a screenshot claims: this reference paid this amount into the shop's account. */
export interface ReceiptClaim {
  txRef: string;
  amount: MoneyString;
  account: KnownAccount;
}

/** The fields Buchi compares, as a bank's receipt page shows them. Pages are untrusted input. */
export const bankReceiptSchema = z.object({
  txRef: z.string().regex(/^[A-Z0-9]{6,20}$/i),
  amount: moneySchema,
  receiver: z.object({
    name: z.string().min(1).nullable(),
    account: z.string().min(4).nullable(),
  }),
  completed: z.boolean(),
  /** The payment time exactly as the page prints it. Payments code reads its format. */
  paidAt: z.string().min(1).nullable(),
});
export type BankReceipt = z.infer<typeof bankReceiptSchema>;

/** A parsed page: the receipt, the bank's "no such transaction" page, or a page Buchi cannot read. */
export type ParsedPage = BankReceipt | 'NOT_FOUND' | 'UNREADABLE';

/** A receipt looked up on a bank's page, or why there is none. */
export type PageReading = BankReceipt | 'NOT_FOUND' | 'UNAVAILABLE';

/** One bank's public receipt page. It never throws: any failure is `UNAVAILABLE`. */
export interface ReceiptClient {
  /** Looks a receipt up by its reference. CBE also needs the receiving account's number. */
  read(txRef: string, accountNumber: string | null): Promise<PageReading>;
}

/** The page confirms the claim only when the reference, amount, and receiver all agree. */
export function compareReceipt(page: BankReceipt, claim: ReceiptClaim): BankCheck {
  const agrees =
    page.completed &&
    page.txRef.toUpperCase() === claim.txRef.toUpperCase() &&
    Money.of(page.amount).compare(Money.of(claim.amount)) === 0 &&
    receiverMatches(page.receiver, claim.account);
  return agrees ? 'CONFIRMED' : 'MISMATCH';
}

/** "20,000.00 ETB" or "100 Birr" as a money string, or undefined when it is not an amount. */
export function amountOf(text: string): MoneyString | undefined {
  const match = /([\d,]+(?:\.\d{1,2})?)\s*(?:ETB|Birr)/i.exec(text);
  return match?.[1]?.replace(/,/g, '');
}
