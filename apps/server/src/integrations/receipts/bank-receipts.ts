import type { PaymentProvider } from '@buchi/shared';
import type { PageReading, ReceiptClient } from './receipt-check';

/**
 * Picks the receipt page for a provider. CBE Birr has no page that works from a transaction
 * reference alone, so its payments always count as not bank-verified.
 */
export class BankReceipts {
  constructor(private readonly clients: Partial<Record<PaymentProvider, ReceiptClient>>) {}

  /** The bank's own page for a reference from a screenshot or a customer's link. */
  read(
    provider: PaymentProvider,
    txRef: string,
    accountNumber: string | null,
  ): Promise<PageReading> {
    return this.clients[provider]?.read(txRef, accountNumber) ?? Promise.resolve('UNAVAILABLE');
  }
}
