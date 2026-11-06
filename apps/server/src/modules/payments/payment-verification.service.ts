import { Money, type BankCheck, type PaymentAccount } from '@buchi/shared';
import type { Database } from '../../db/client';
import { withShop } from '../../db/with-shop';
import type { BankReceipts } from '../../integrations/receipts/bank-receipts';
import type { CustomersService } from '../customers/customers.service';
import type { OrderService } from '../orders/orders.service';
import { PAYMENT_HOLD_MS } from '../orders/orders.deadlines.domain';
import type { Button } from '../owner/owner.domain';
import type { MessageRef } from '../owner/owner-notifier.service';
import type { ShopsService } from '../shops/shops.service';
import {
  customerMessage,
  ownerApproved,
  ownerRejected,
  reportButton,
  reviewCaption,
} from './payment-messages.domain';
import type { PaymentNotifier } from './payment-notifier.service';
import type { PaymentProofRow, PaymentProofsRepo } from './payment-proofs.repo';
import type { PaymentRefsRepo } from './payment-refs.repo';
import {
  decide,
  type CheckedRules,
  type Decision,
  type RuleResults,
} from './payments.decision.domain';
import {
  amountDue,
  checkAmount,
  checkReference,
  checkTime,
  isSupported,
  matchingAccount,
  readReceipt,
  type ReadReceipt,
  type SupportedReceipt,
} from './payments.domain';
import { reviewCallbackData, type ReceiptExtraction } from './payments.schemas';
import type { Image, ReceiptReader } from './receipt-reader.service';
import type { Payer } from './risk.domain';
import type { RiskService } from './risk.service';

/** An order waiting for payment, as the order service returns it. */
type OrderRow = NonNullable<Awaited<ReturnType<OrderService['latestUnpaid']>>>;

/** A screenshot as it arrived: Telegram's file ID, the chat message, and the image itself. */
interface ReceivedReceipt {
  fileId: string;
  message: MessageRef;
  image: Image;
  /** The classifier's confidence that this is a receipt, or `null` when it was unavailable. */
  classificationConfidence: number | null;
}

interface Evaluation {
  decision: Decision;
  extraction: ReceiptExtraction | undefined;
  rules: RuleResults | null;
  receipt: ReadReceipt | undefined;
  bank: BankCheck | null;
  /** Set when this order holds the reference, so a rejection can free it. */
  claimed: SupportedReceipt | undefined;
}

/** What the customer reads after the check, with **Report a problem** under a rejection. */
export interface CustomerReply {
  text: string;
  buttons: Button[];
}

/** Checks a payment screenshot in the design doc's four layers and acts on the decision. */
export class PaymentVerification {
  constructor(
    private readonly db: Database,
    private readonly proofs: PaymentProofsRepo,
    private readonly refs: PaymentRefsRepo,
    private readonly reader: Pick<ReceiptReader, 'extract'>,
    private readonly bank: Pick<BankReceipts, 'check'>,
    private readonly risk: RiskService,
    private readonly orders: OrderService,
    private readonly shops: Pick<ShopsService, 'get'>,
    private readonly customers: Pick<CustomersService, 'get'>,
    private readonly notifier: PaymentNotifier,
    private readonly now: () => Date,
  ) {}

  async verify(order: OrderRow, received: ReceivedReceipt): Promise<CustomerReply> {
    const { shopId } = order;
    await this.orders.transition(
      shopId,
      order.id,
      'payment_submitted',
      'customer',
      'Payment screenshot received',
    );
    const customer = await this.customers.get(shopId, order.customerId);
    const payer: Payer = { telegramUserId: customer.telegramUserId, phone: customer.phone };
    const evaluation = await this.evaluate(order, received, payer);
    const { receipt } = evaluation;
    const proof = await withShop(this.db, shopId, (tx) =>
      this.proofs.insert(tx, {
        shopId,
        orderId: order.id,
        telegramFileId: received.fileId,
        extraction: evaluation.extraction ?? null,
        provider: receipt && isSupported(receipt) ? receipt.provider : null,
        txRef: receipt?.txRef ?? null,
        amount: receipt?.amount.toString() ?? null,
        rules: evaluation.rules,
        bankCheck: evaluation.bank,
        decision: evaluation.decision.outcome,
        reasons: reasonsOf(evaluation.decision),
      }),
    );
    await this.act(order, proof, evaluation, received.message, payer);
    const { decision } = evaluation;
    return {
      text: customerMessage(decision, order.id),
      buttons: decision.outcome === 'reject' ? [reportButton(order.id)] : [],
    };
  }

  private async evaluate(
    order: OrderRow,
    received: ReceivedReceipt,
    payer: Payer,
  ): Promise<Evaluation> {
    const extraction = await this.reader.extract(received.image);
    const none = { extraction, rules: null, receipt: undefined, bank: null, claimed: undefined };
    if (!extraction)
      return { ...none, decision: { outcome: 'review', reason: 'extraction_failed' } };

    const earlier = await withShop(this.db, order.shopId, (tx) =>
      this.proofs.forOrder(tx, order.id),
    );
    const receipt = readReceipt(extraction, received.classificationConfidence);
    if (!receipt) {
      const earlierUnreadable = earlier.filter((p) => p.decision === 'ask_clearer').length;
      return {
        ...none,
        rules: { r1: 'fail' },
        decision: decide({ stage: 'unreadable', earlierUnreadable }),
      };
    }
    if (!isSupported(receipt)) {
      return {
        ...none,
        receipt,
        rules: { r1: 'pass', r2: 'fail' },
        decision: decide({ stage: 'unsupported_provider' }),
      };
    }

    const { paymentAccounts } = await this.shops.get(order.shopId);
    const account = matchingAccount(receipt, paymentAccounts);
    const due = amountDue(Money.of(order.total), partialPayments(earlier), receipt.txRef);
    const holder = await this.refs.claim(receipt.provider, receipt.txRef, order.id);
    const rules: CheckedRules = {
      r1: 'pass',
      r2: 'pass',
      r3: checkAmount(receipt.amount, due),
      r4: account ? 'pass' : 'fail',
      r5: checkTime(receipt.paidAt, order.createdAt),
      r6: checkReference(holder, order.id),
    };
    const bank = account ? await this.checkBank(receipt, account) : null;
    const decision = decide({
      stage: 'checked',
      rules,
      // Without a matching account there is nothing to look up, and R4 rejects the receipt anyway.
      bank: bank ?? 'UNAVAILABLE',
      paid: receipt.amount,
      due,
      payerHighRisk: await this.risk.isHighRisk(payer),
    });
    const claimed = rules.r6 === 'pass' ? receipt : undefined;
    return { decision, extraction, rules, receipt, bank, claimed };
  }

  private checkBank(receipt: SupportedReceipt, account: PaymentAccount): Promise<BankCheck> {
    return this.bank.check(receipt.provider, {
      txRef: receipt.txRef,
      amount: receipt.amount.toString(),
      account,
    });
  }

  /** Moves the order on and tells the owners. The customer's reply is the caller's job. */
  private async act(
    order: OrderRow,
    proof: PaymentProofRow,
    evaluation: Evaluation,
    screenshot: MessageRef,
    payer: Payer,
  ): Promise<void> {
    const { shopId, id: orderId } = order;
    const { decision } = evaluation;
    switch (decision.outcome) {
      case 'approve': {
        const reason = decision.bankVerified
          ? 'Payment checked with the bank'
          : 'Payment approved without a bank check';
        await this.orders.transition(shopId, orderId, 'payment_approved', 'system', reason);
        await this.notifier.toOwners(shopId, orderId, {
          text: ownerApproved({ orderId, total: order.total }, decision.bankVerified),
        });
        return;
      }
      case 'reject': {
        await this.orders.transition(
          shopId,
          orderId,
          'payment_rejected',
          'system',
          'Payment rejected',
        );
        const { claimed } = evaluation;
        if (claimed) await this.refs.release(claimed.provider, claimed.txRef, orderId);
        const kind = decision.reasons.includes('bank_mismatch')
          ? 'bank_mismatch'
          : 'receipt_rejected';
        await this.risk.record(shopId, kind, payer);
        await this.notifier.toOwners(shopId, orderId, {
          text: ownerRejected(orderId, decision.reasons),
        });
        return;
      }
      case 'review': {
        await this.orders.transition(
          shopId,
          orderId,
          'payment_unclear',
          'system',
          'Payment needs the owner',
        );
        const caption = reviewCaption({
          orderId,
          total: order.total,
          reason: decision.reason,
          receipt: evaluation.receipt,
          bank: evaluation.bank,
        });
        await this.notifier.toOwners(shopId, orderId, { copyOf: screenshot, caption }, [
          { text: '✅ Approve', data: reviewCallbackData('approve', proof.id) },
          { text: '❌ Reject', data: reviewCallbackData('reject', proof.id) },
        ]);
        return;
      }
      case 'ask_difference':
        await this.orders.awaitPaymentAgain(shopId, orderId, 'Partial payment', this.holdUntil());
        return;
      case 'ask_clearer':
        await this.orders.awaitPaymentAgain(
          shopId,
          orderId,
          'Unreadable screenshot',
          this.holdUntil(),
        );
        return;
    }
  }

  /**
   * A new hold from now, because the check may have outlasted the first one and the customer still
   * needs time to send the rest or a clearer screenshot.
   */
  private holdUntil(): Date {
    return new Date(this.now().getTime() + PAYMENT_HOLD_MS);
  }
}

/** Earlier bank-confirmed partial payments of the order, which reduce what is still due. */
function partialPayments(proofs: PaymentProofRow[]): { txRef: string; amount: Money }[] {
  return proofs.flatMap((p) =>
    p.decision === 'ask_difference' && p.txRef !== null && p.amount !== null
      ? [{ txRef: p.txRef, amount: Money.of(p.amount) }]
      : [],
  );
}

function reasonsOf(decision: Decision): string[] {
  if (decision.outcome === 'reject') return decision.reasons;
  return decision.outcome === 'review' ? [decision.reason] : [];
}
