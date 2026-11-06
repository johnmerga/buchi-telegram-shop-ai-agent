import type { BankCheck, PaymentProvider } from '@buchi/shared';
import {
  compareReceipt,
  type PageReading,
  type ReceiptClaim,
  type ReceiptClient,
} from './receipt-check';

/**
 * Picks the receipt page for a provider. CBE Birr has no page that works from a transaction
 * reference alone, so its payments always count as not bank-verified.
 */
export class BankReceipts {
  constructor(private readonly clients: Partial<Record<PaymentProvider, ReceiptClient>>) {}

  /** Compares what a screenshot claims with the bank's own page. */
  async check(provider: PaymentProvider, claim: ReceiptClaim): Promise<BankCheck> {
    const page = await this.read(provider, claim.txRef, claim.account.accountNumber);
    return typeof page === 'string' ? page : compareReceipt(page, claim);
  }

  /** The bank's own page for a reference, such as one that a customer's link names. */
  read(
    provider: PaymentProvider,
    txRef: string,
    accountNumber: string | null,
  ): Promise<PageReading> {
    return this.clients[provider]?.read(txRef, accountNumber) ?? Promise.resolve('UNAVAILABLE');
  }
}
