import { Money, type BankCheck } from '@buchi/shared';
import type { Database } from '../../db/client';
import { withShop } from '../../db/with-shop';
import type { BankReceipts } from '../../integrations/receipts/bank-receipts';
import type { BankReceipt } from '../../integrations/receipts/receipt-check';
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
  type ReviewReason,
  type RuleResults,
} from './payments.decision.domain';
import {
  amountDue,
  checkAmount,
  checkReference,
  checkTime,
  matchingAccount,
} from './payments.domain';
import {
  receiptExtractionSchema,
  reviewCallbackData,
  type ReceiptExtraction,
} from './payments.schemas';
import type { Image, ReceiptReader } from './receipt-reader.service';
import type { ReceiptProvider } from './receipt-layouts.domain';
import {
  decideUnread,
  interpretReceipt,
  readBankPage,
  withReference,
  type ReadReceipt,
  type Reading,
} from './receipt-reading.domain';
import { readScreenshot } from './screenshot-reading';
import type { Payer } from './risk.domain';
import type { RiskService } from './risk.service';

/** An order waiting for payment, as the order service returns it. */
type OrderRow = NonNullable<Awaited<ReturnType<OrderService['latestUnpaid']>>>;

/**
 * A payment proof as it arrived: a screenshot with Telegram's file ID and the image itself, the
 * bank's own page that a customer's link or reference pointed to, or a screenshot read earlier
 * with the reference that the customer typed. `message` is the chat message that owners see in a
 * review.
 */
export type ReceivedProof =
  | {
      kind: 'screenshot';
      fileId: string;
      message: MessageRef;
      image: Image;
      /** The classifier's confidence that this is a receipt, or `null` when it was unavailable. */
      classificationConfidence: number | null;
    }
  | { kind: 'bank_page'; message: MessageRef; provider: ReceiptProvider; page: BankReceipt }
  | {
      kind: 'typed_reference';
      message: MessageRef;
      fileId: string | null;
      extraction: ReceiptExtraction;
    };

const submittedReasons: Record<ReceivedProof['kind'], string> = {
  screenshot: 'Payment screenshot received',
  bank_page: 'Payment receipt link received',
  typed_reference: 'Transaction reference typed',
};

interface Evaluation {
  decision: Decision;
  extraction: ReceiptExtraction | undefined;
  rules: RuleResults | null;
  receipt: ReadReceipt | undefined;
  bank: BankCheck | null;
  /** Set when this order holds the reference, so a rejection can free it. */
  claimed: ReadReceipt | undefined;
}

/** What the customer reads after the check, with **Report a problem** under a rejection. */
export interface CustomerReply {
  text: string;
  buttons: Button[];
}

/**
 * Checks a payment screenshot, or the bank page that a link opened, in the design doc's four
 * layers and acts on the decision.
 */
export class PaymentVerification {
  constructor(
    private readonly db: Database,
    private readonly proofs: PaymentProofsRepo,
    private readonly refs: PaymentRefsRepo,
    private readonly reader: Pick<ReceiptReader, 'extract' | 'readReference'>,
    private readonly bank: Pick<BankReceipts, 'read'>,
    private readonly risk: RiskService,
    private readonly orders: OrderService,
    private readonly shops: Pick<ShopsService, 'get'>,
    private readonly customers: Pick<CustomersService, 'get'>,
    private readonly notifier: PaymentNotifier,
    private readonly now: () => Date,
  ) {}

  async verify(order: OrderRow, received: ReceivedProof): Promise<CustomerReply> {
    const { shopId } = order;
    await this.orders.transition(
      shopId,
      order.id,
      'payment_submitted',
      'customer',
      submittedReasons[received.kind],
    );
    const customer = await this.customers.get(shopId, order.customerId);
    const payer: Payer = { telegramUserId: customer.telegramUserId, phone: customer.phone };
    const evaluation = await this.evaluate(order, received, payer);
    const { receipt } = evaluation;
    const proof = await withShop(this.db, shopId, (tx) =>
      this.proofs.insert(tx, {
        shopId,
        orderId: order.id,
        telegramFileId: received.kind === 'bank_page' ? null : received.fileId,
        extraction: evaluation.extraction ?? null,
        provider: receipt?.provider ?? null,
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
      text: customerMessage(decision, order),
      buttons: decision.outcome === 'reject' ? [reportButton(order.id)] : [],
    };
  }

  /**
   * A reference that the customer typed after Buchi asked for it. It stands in for the misread one
   * in the screenshot that the order's latest proof read. Returns `undefined` when the order is not
   * waiting for a reference.
   */
  async verifyTypedReference(
    order: OrderRow,
    reference: string,
    message: MessageRef,
  ): Promise<CustomerReply | undefined> {
    const proofs = await withShop(this.db, order.shopId, (tx) =>
      this.proofs.forOrder(tx, order.id),
    );
    const latest = proofs.toSorted((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    if (latest?.decision !== 'ask_reference') return undefined;
    const stored = receiptExtractionSchema.safeParse(latest.extraction);
    if (!stored.success) return undefined;
    return this.verify(order, {
      kind: 'typed_reference',
      message,
      fileId: latest.telegramFileId,
      extraction: withReference(stored.data, reference),
    });
  }

  /** The model only copies a screenshot's text, and code reads it. A bank page needs no model. */
  private async read(
    received: ReceivedProof,
  ): Promise<{ extraction?: ReceiptExtraction; reading: Reading } | undefined> {
    switch (received.kind) {
      case 'bank_page':
        return { reading: readBankPage(received.provider, received.page) };
      case 'typed_reference':
        return {
          extraction: received.extraction,
          reading: interpretReceipt(received.extraction, null, { referenceTyped: true }),
        };
      case 'screenshot':
        return readScreenshot(this.reader, received.image, received.classificationConfidence);
    }
  }

  private async evaluate(
    order: OrderRow,
    received: ReceivedProof,
    payer: Payer,
  ): Promise<Evaluation> {
    const read = await this.read(received);
    const none = { rules: null, receipt: undefined, bank: null, claimed: undefined };
    if (!read) return { ...none, extraction: undefined, decision: review('extraction_failed') };
    const { extraction } = read;
    const earlier = await withShop(this.db, order.shopId, (tx) =>
      this.proofs.forOrder(tx, order.id),
    );
    const { reading, bank } = await this.withBank(order, received, read.reading);
    if (reading.status === 'read') {
      const referenceTyped = received.kind === 'typed_reference';
      const checked = await this.checkRules(
        order,
        reading.receipt,
        earlier,
        bank,
        payer,
        referenceTyped,
      );
      return { extraction, ...checked };
    }
    const asks = (decision: PaymentProofRow['decision']) =>
      earlier.filter((p) => p.decision === decision).length;
    const earlierAsks = { unreadable: asks('ask_clearer'), reference: asks('ask_reference') };
    return { ...none, extraction, ...decideUnread(reading, earlierAsks) };
  }

  /**
   * What the bank says about a receipt. A bank page that a link opened is the bank's own record,
   * so it confirms itself.
   */
  private async withBank(
    order: OrderRow,
    received: ReceivedProof,
    reading: Reading,
  ): Promise<{ reading: Reading; bank: BankCheck | null }> {
    if (received.kind === 'bank_page') return { reading, bank: 'CONFIRMED' };
    return reading.status === 'read'
      ? this.lookUp(order, reading.receipt)
      : { reading, bank: null };
  }

  /**
   * Looks a screenshot up on the bank's own page, which then stands in for the screenshot: its
   * amount, full receiver, and time are the bank's record. A screenshot whose first name or
   * account is not the shop's is rejected by R4 without a lookup. A page whose receiver is not the
   * shop's account contradicts the screenshot.
   */
  private async lookUp(
    order: OrderRow,
    screenshot: ReadReceipt,
  ): Promise<{ reading: Reading; bank: BankCheck | null }> {
    const { paymentAccounts } = await this.shops.get(order.shopId);
    const account = matchingAccount(screenshot, paymentAccounts);
    const asPrinted = { status: 'read', receipt: screenshot } as const;
    if (!account) return { reading: asPrinted, bank: null };
    const page = await this.bank.read(screenshot.provider, screenshot.txRef, account.accountNumber);
    if (typeof page === 'string') return { reading: asPrinted, bank: page };
    const reading = readBankPage(screenshot.provider, page);
    if (reading.status !== 'read') return { reading, bank: null };
    const sameReceiver = matchingAccount(reading.receipt, [account]) !== undefined;
    return { reading, bank: sameReceiver ? 'CONFIRMED' : 'MISMATCH' };
  }

  /** Rules R3 to R6 for a receipt that code could read, with what the bank's page said. */
  private async checkRules(
    order: OrderRow,
    receipt: ReadReceipt,
    earlier: PaymentProofRow[],
    bank: BankCheck | null,
    payer: Payer,
    referenceTyped: boolean,
  ): Promise<Omit<Evaluation, 'extraction'>> {
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
    const decision = decide({
      stage: 'checked',
      rules,
      // Without a matching account there is nothing to look up, and R4 rejects the receipt anyway.
      bank: bank ?? 'UNAVAILABLE',
      paid: receipt.amount,
      due,
      payerHighRisk: await this.risk.isHighRisk(payer),
      receiverFirstNameOnly: receipt.receiverFirstNameOnly,
      referenceTyped,
    });
    const claimed = rules.r6 === 'pass' ? receipt : undefined;
    return { decision, rules, receipt, bank, claimed };
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
      case 'ask_full_amount':
        await this.orders.awaitPaymentAgain(
          shopId,
          orderId,
          'Receipt below the total',
          this.holdUntil(),
        );
        return;
      case 'ask_clearer':
        await this.orders.awaitPaymentAgain(
          shopId,
          orderId,
          'Unreadable screenshot',
          this.holdUntil(),
        );
        return;
      case 'ask_reference':
        await this.orders.awaitPaymentAgain(
          shopId,
          orderId,
          'Unreadable transaction reference',
          this.holdUntil(),
        );
        return;
    }
  }

  /**
   * A new hold from now, because the check may have outlasted the first one and the customer still
   * needs time to send the rest, a clearer screenshot, or the reference.
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

const review = (reason: ReviewReason): Decision => ({ outcome: 'review', reason });

function reasonsOf(decision: Decision): string[] {
  if (decision.outcome === 'reject') return decision.reasons;
  return decision.outcome === 'review' ? [decision.reason] : [];
}
