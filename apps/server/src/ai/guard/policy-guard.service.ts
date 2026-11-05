import type { Money } from '@buchi/shared';
import type { Database } from '../../db/client';
import { withShop } from '../../db/with-shop';
import type { ToolCallContext, ToolResult } from '../tool';
import { toToolResult, type Decision } from './decision';
import type { DecisionsRepo } from './decisions.repo';
import {
  checkDeadlineExtension,
  type DeadlineExtensionDecision,
} from './deadline-extension.domain';
import {
  checkDeliveryPrice,
  type DeliveryPriceDecision,
  type DeliveryPriceLimits,
} from './delivery-price.domain';
import {
  checkNegotiatedPrice,
  type NegotiationState,
  type PriceDecision,
  type PriceLimits,
} from './negotiated-price.domain';

/** A value an agent chose, with its one-sentence reason and the IDs of the evidence it used. */
export interface Proposal<Value> {
  value: Value;
  reason: string;
  evidenceIds: string[];
}

/**
 * The full decision for the tool handler, and the reduced result for the model. Handlers return
 * `toolResult` to the model and act on `decision` themselves.
 */
export interface GuardOutcome<D> {
  decision: D;
  toolResult: ToolResult;
  /** The recorded decision, which the owner answers when it needs the owner. */
  decisionId: string;
}

type LimitsRecord = Record<string, string | number | null>;

const formatMoney = (amount: Money) => amount.toString();
const asIs = (minutes: number) => minutes;

/**
 * The only path from an agent's proposed value to an action. Each check applies its pure checker,
 * records the decision with the private limits, and gives the model a result without them.
 */
export class PolicyGuard {
  constructor(
    private readonly db: Database,
    private readonly repo: DecisionsRepo,
  ) {}

  checkNegotiatedPrice(
    context: ToolCallContext,
    proposal: Proposal<Money>,
    limits: PriceLimits,
    state: NegotiationState,
  ): Promise<GuardOutcome<PriceDecision>> {
    const decision = checkNegotiatedPrice(proposal.value, limits, state);
    return this.record(context, proposal, {}, decision, formatMoney, {
      asking: limits.asking.toString(),
      lowest: limits.lowest.toString(),
      lastOffer: state.lastOffer?.toString() ?? null,
      concessionsMade: state.concessionsMade,
    });
  }

  checkDeliveryPrice(
    context: ToolCallContext,
    proposal: Proposal<Money>,
    limits: DeliveryPriceLimits,
  ): Promise<GuardOutcome<DeliveryPriceDecision>> {
    const decision = checkDeliveryPrice(proposal.value, limits);
    return this.record(context, proposal, {}, decision, formatMoney, {
      formulaPayout: limits.formulaPayout.toString(),
      cap: limits.cap.toString(),
    });
  }

  /** The order is recorded with the minutes, so an owner's approval can extend that order. */
  checkDeadlineExtension(
    context: ToolCallContext,
    proposal: Proposal<number>,
    order: { orderId: string; extensionsMade: number },
  ): Promise<GuardOutcome<DeadlineExtensionDecision>> {
    const decision = checkDeadlineExtension(proposal.value, order.extensionsMade);
    return this.record(context, proposal, { orderId: order.orderId }, decision, asIs, {
      extensionsMade: order.extensionsMade,
    });
  }

  /**
   * Records the owner's answer to a checked value that needed the owner, such as a far-area price
   * above the cap. Returns false when it was already answered, so a second tap changes nothing.
   */
  async answerOwner(
    shopId: string,
    decisionId: string,
    answer: { status: 'approved' | 'declined'; decidedBy: number; decidedAt: Date },
  ): Promise<boolean> {
    const decided = await withShop(this.db, shopId, (tx) =>
      this.repo.decide(tx, decisionId, answer),
    );
    return decided !== undefined;
  }

  /** Holds an `owner_confirms` action as a pending request until the owner approves it. */
  async requestOwnerConfirmation(
    context: ToolCallContext,
    proposed: Record<string, unknown>,
  ): Promise<ToolResult> {
    await withShop(this.db, context.shopId, (tx) =>
      this.repo.insert(tx, {
        ...scopeOf(context),
        proposed,
        result: 'needs_owner',
        reason: 'owner_confirms',
        ownerStatus: 'pending',
      }),
    );
    return { status: 'awaiting_owner' };
  }

  /** `subject` names what the value is for, such as the order of a deadline. */
  private async record<Value, D extends Decision<Value>>(
    context: ToolCallContext,
    proposal: Proposal<Value>,
    subject: Record<string, string>,
    decision: D,
    serialize: (value: Value) => string | number,
    limits: LimitsRecord,
  ): Promise<GuardOutcome<D>> {
    const decisionId = await withShop(this.db, context.shopId, (tx) =>
      this.repo.insert(tx, {
        ...scopeOf(context),
        proposed: { ...subject, value: serialize(proposal.value) },
        limits,
        result: decision.result,
        reason: decision.reason,
        counteroffer:
          decision.result === 'rejected' ? { value: serialize(decision.counteroffer) } : null,
        agentReason: proposal.reason,
        evidenceIds: proposal.evidenceIds,
        ownerStatus: decision.result === 'needs_owner' ? 'pending' : null,
      }),
    );
    return { decision, toolResult: toToolResult(decision, serialize), decisionId };
  }
}

function scopeOf({ shopId, runId, agent, tool }: ToolCallContext) {
  return { shopId, runId, agent, tool };
}
