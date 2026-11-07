import type { BankReceipts } from '../../integrations/receipts/bank-receipts';
import type { BankReceipt } from '../../integrations/receipts/receipt-check';
import type { OrderService } from '../orders/orders.service';
import type { MessageRef } from '../owner/owner-notifier.service';
import type { ShopsService } from '../shops/shops.service';
import {
  alreadyChecking,
  cbeAppLinkReply,
  noUnpaidOrder,
  orderClosed,
  receiptPageUnavailable,
} from './payment-messages.domain';
import type { CustomerReply, PaymentVerification } from './payment-verification.service';
import type { ReceiptProvider } from './receipt-layouts.domain';
import type { ReceiptLink } from './receipt-links.domain';

/**
 * A receipt link or CBE reference that a customer sent as text. Code reads the bank's own page,
 * without the model, and the page goes through the same rules as a screenshot. A reference that
 * Buchi asked for completes the screenshot it could not read instead.
 */
export class ReceiptLinks {
  constructor(
    private readonly orders: Pick<OrderService, 'latestUnpaid' | 'latest'>,
    private readonly shops: Pick<ShopsService, 'get'>,
    private readonly bank: Pick<BankReceipts, 'read'>,
    private readonly verification: Pick<PaymentVerification, 'verify' | 'verifyTypedReference'>,
  ) {}

  /** The reply for the customer, with **Report a problem** under a rejection. */
  async receive(
    shopId: string,
    telegramUserId: number,
    link: ReceiptLink,
    message: MessageRef,
  ): Promise<CustomerReply> {
    const text = (reply: string): CustomerReply => ({ text: reply, buttons: [] });
    const order = await this.orders.latestUnpaid(shopId, telegramUserId);
    if (!order) {
      // A rejected payment is final, so its order takes no more links either.
      const last = await this.orders.latest(shopId, telegramUserId);
      return text(last?.status === 'payment_rejected' ? orderClosed(last.id) : noUnpaidOrder);
    }
    if (order.status !== 'awaiting_payment') return text(alreadyChecking(order.id));
    if (link.kind === 'cbe' && link.accountDigits === null) {
      // A bare reference may answer Buchi's question about a screenshot's misread one.
      const typed = await this.verification.verifyTypedReference(order, link.txRef, message);
      if (typed) return typed;
    }
    if (link.kind === 'cbe_app') return text(cbeAppLinkReply);
    const found = await this.lookUp(shopId, link);
    if (!found) return text(receiptPageUnavailable);
    return this.verification.verify(order, { kind: 'bank_page', message, ...found });
  }

  /**
   * Something like a reference that a customer typed, which counts only while their order waits
   * for one. Returns `undefined` otherwise, and the message goes on to the sales agent.
   */
  async receiveTyped(
    shopId: string,
    telegramUserId: number,
    reference: string,
    message: MessageRef,
  ): Promise<CustomerReply | undefined> {
    const order = await this.orders.latestUnpaid(shopId, telegramUserId);
    if (order?.status !== 'awaiting_payment') return undefined;
    return this.verification.verifyTypedReference(order, reference, message);
  }

  private async lookUp(
    shopId: string,
    link: Exclude<ReceiptLink, { kind: 'cbe_app' }>,
  ): Promise<{ provider: ReceiptProvider; page: BankReceipt } | undefined> {
    if (link.kind === 'telebirr') {
      const page = await this.bank.read('telebirr', link.txRef, null);
      return typeof page === 'string' ? undefined : { provider: 'telebirr', page };
    }
    // CBE finds a receipt only with the receiving account, so a bare reference tries each of the
    // shop's CBE accounts.
    const accounts =
      link.accountDigits === null
        ? (await this.shops.get(shopId)).paymentAccounts
            .filter((account) => account.provider === 'cbe_bank')
            .map((account) => account.accountNumber)
        : [link.accountDigits];
    for (const account of accounts) {
      const page = await this.bank.read('cbe_bank', link.txRef, account);
      if (typeof page !== 'string') return { provider: 'cbe_bank', page };
    }
    return undefined;
  }
}
