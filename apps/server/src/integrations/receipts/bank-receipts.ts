import type { BankCheck, PaymentProvider } from '@buchi/shared';
import type { ReceiptClaim, ReceiptClient } from './receipt-check';

/**
 * Picks the receipt page for a provider. CBE Birr has no page that works from a transaction
 * reference alone, so its payments always count as not bank-verified.
 */
export class BankReceipts {
  constructor(private readonly clients: Partial<Record<PaymentProvider, ReceiptClient>>) {}

  check(provider: PaymentProvider, claim: ReceiptClaim): Promise<BankCheck> {
    return this.clients[provider]?.check(claim) ?? Promise.resolve('UNAVAILABLE');
  }
}
