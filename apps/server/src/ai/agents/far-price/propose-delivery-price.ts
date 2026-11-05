import { Money, moneySchema } from '@buchi/shared';
import { z } from 'zod';
import { AppError } from '../../../shared/errors';
import type { DeliveryPriceLimits } from '../../guard/delivery-price.domain';
import type { PolicyGuard } from '../../guard/policy-guard.service';
import { defineTool, type Tool } from '../../tool';

/** A price the guard let through: within the limits, or waiting for the owner above the cap. */
export interface ProposedPrice {
  price: Money;
  reason: string;
  decisionId: string;
  needsOwner: boolean;
}

export interface ProposeDeliveryPriceDeps {
  guard: Pick<PolicyGuard, 'checkDeliveryPrice'>;
  limits: DeliveryPriceLimits;
  /** The evidence IDs of this trip, the only ones the model may cite. */
  evidenceIds: [string, ...string[]];
  propose(proposal: ProposedPrice): void;
}

/**
 * The far-price agent's one tool, built for one trip so the model never names the quote it prices.
 * Every price passes the policy guard, and only the first price that passes counts.
 */
export function proposeDeliveryPriceTool(deps: ProposeDeliveryPriceDeps): Tool {
  let proposed = false;
  return defineTool({
    name: 'propose_delivery_price',
    description:
      'Proposes the price, in birr, to offer the drivers for this far-area trip, with a ' +
      'one-sentence reason and the IDs of the evidence you used. A rejected price comes with a ' +
      'counteroffer you may propose instead.',
    agents: ['operations'],
    autonomy: 'automatic',
    input: z.object({
      price: moneySchema,
      reason: z.string().trim().min(1).max(200),
      evidenceIds: z.array(z.enum(deps.evidenceIds)).min(1).max(deps.evidenceIds.length),
    }),
    handle: async ({ price, reason, evidenceIds }, context) => {
      if (proposed) throw new AppError('CONFLICT', 'A price for this trip is already proposed.');
      const { decision, toolResult, decisionId } = await deps.guard.checkDeliveryPrice(
        context,
        { value: Money.of(price), reason, evidenceIds },
        deps.limits,
      );
      if (decision.result !== 'rejected') {
        proposed = true;
        deps.propose({
          price: Money.of(price),
          reason,
          decisionId,
          needsOwner: decision.result === 'needs_owner',
        });
      }
      return toolResult;
    },
  });
}
