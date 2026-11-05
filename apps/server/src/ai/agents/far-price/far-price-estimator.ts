import { randomUUID } from 'node:crypto';
import type { Money } from '@buchi/shared';
import type { Logger } from 'pino';
import {
  statisticalPrice,
  type FarPriceEvidence,
} from '../../../modules/far-quotes/far-quotes.domain';
import type { PolicyGuard } from '../../guard/policy-guard.service';
import { farPricePrompt } from '../../prompts/far-price';
import type { AgentDefinition, AgentRuntime } from '../../runtime';
import { failureOf } from '../../structured-output';
import type { Tool, ToolActor } from '../../tool';
import { evidenceIds, evidenceText } from './evidence-text.domain';
import { proposeDeliveryPriceTool, type ProposedPrice } from './propose-delivery-price';

/**
 * Price estimates weigh evidence, so they use the smart tier, as the design doc routes them. A far
 * quote is rare and the customer waits ten minutes anyway, so the slower model costs nothing that
 * matters. The operations priority yields to payments and customer replies when quota is short,
 * and the statistical estimate covers the gap.
 */
const farPriceAgent: AgentDefinition = {
  name: 'operations',
  prompt: farPricePrompt,
  tier: 'smart',
  priority: 'operations',
};

const system: ToolActor = { kind: 'system' };

/** The first price for a far trip, as the policy guard recorded it. */
export interface FarPriceEstimate extends ProposedPrice {
  source: 'agent' | 'statistics';
}

export interface FarPriceRequest {
  shopId: string;
  evidence: FarPriceEvidence;
  cap: Money;
}

/** An agent runtime whose registry holds exactly these tools. */
export type RuntimeFor = (tools: Tool[]) => Pick<AgentRuntime, 'run'>;

/**
 * Estimates a far trip's first price. The operations agent proposes it through the policy guard;
 * when Gemini is unavailable or proposes nothing usable, the statistics do, through the same guard.
 */
export class FarPriceEstimator {
  constructor(
    private readonly runtimeFor: RuntimeFor,
    private readonly guard: Pick<PolicyGuard, 'checkDeliveryPrice'>,
    private readonly logger: Logger,
  ) {}

  async estimate(request: FarPriceRequest): Promise<FarPriceEstimate> {
    const proposal = await this.fromAgent(request);
    return proposal ? { ...proposal, source: 'agent' } : this.fromStatistics(request);
  }

  private async fromAgent(request: FarPriceRequest): Promise<ProposedPrice | undefined> {
    const { shopId, evidence, cap } = request;
    let proposal: ProposedPrice | undefined;
    const tool = proposeDeliveryPriceTool({
      guard: this.guard,
      limits: { formulaPayout: evidence.formulaPayout, cap },
      evidenceIds: evidenceIds(evidence),
      propose: (proposed) => {
        proposal = proposed;
      },
    });
    try {
      const result = await this.runtimeFor([tool]).run(farPriceAgent, {
        shopId,
        actor: system,
        history: [{ role: 'user', parts: [{ text: evidenceText(evidence) }] }],
      });
      if (!proposal) {
        this.logger.warn({ shopId, runId: result.runId }, 'far-price agent proposed no price');
      }
    } catch (err) {
      this.logger.warn({ shopId, failure: failureOf(err) }, 'far-price agent unavailable');
    }
    return proposal;
  }

  /** The formula payout times the acceptance factor, checked like any proposed price. */
  private async fromStatistics(request: FarPriceRequest): Promise<FarPriceEstimate> {
    const { shopId, evidence, cap } = request;
    const { formulaPayout, acceptanceFactor } = evidence;
    const price = statisticalPrice(formulaPayout, acceptanceFactor.value);
    const reason = `Formula payout × acceptance factor ${acceptanceFactor.value.toFixed(2)} (${String(acceptanceFactor.trips)} trips).`;
    const { decision, decisionId } = await this.guard.checkDeliveryPrice(
      {
        shopId,
        runId: randomUUID(),
        agent: 'operations',
        actor: system,
        tool: 'statistical_estimate',
      },
      { value: price, reason, evidenceIds: ['formula', 'acceptance_factor'] },
      { formulaPayout, cap },
    );
    // The statistical price is never below the formula payout, so the guard cannot reject it.
    if (decision.result === 'rejected') throw new Error('The guard rejected a statistical price');
    return {
      price,
      reason,
      decisionId,
      needsOwner: decision.result === 'needs_owner',
      source: 'statistics',
    };
  }
}
