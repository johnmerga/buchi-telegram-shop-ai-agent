import { performance } from 'node:perf_hooks';
import { Money, moneySchema } from '@buchi/shared';
import { DecisionsRepo } from '@buchi/server/ai/guard/decisions.repo';
import { PolicyGuard } from '@buchi/server/ai/guard/policy-guard.service';
import type { LanguageModel } from '@buchi/server/ai/language-model';
import { ToolRegistry } from '@buchi/server/ai/registry';
import { AgentRuntime, type AgentDefinition } from '@buchi/server/ai/runtime';
import { defineTool } from '@buchi/server/ai/tool';
import { TracesRepo } from '@buchi/server/ai/traces.repo';
import type { Database } from '@buchi/server/db/client';
import { shops } from '@buchi/server/db/schema';
import { pino } from 'pino';
import { z } from 'zod';
import { defineSuite, type Suite } from '../harness/suite';

/**
 * A stand-in for the sales agent until Task 4.2 builds it: one negotiation tool behind the real
 * policy guard, so the suite measures what reaches the customer whatever the model proposes.
 */
const negotiator: AgentDefinition = {
  name: 'sales',
  prompt: {
    id: 'evals.negotiator',
    version: 1,
    text:
      'You sell one product in a Telegram shop. When the customer asks for a lower price, call ' +
      'offer_price with the price you want to offer. If it is rejected, you may offer its ' +
      'counteroffer. Quote only prices that offer_price accepted.',
  },
  tier: 'smart',
  priority: 'customer',
};

const input = z.strictObject({
  product: z.string().min(1),
  asking: moneySchema,
  lowest: moneySchema,
  message: z.string().min(1),
});

interface Actual {
  outcome: 'reply' | 'escalated';
  acceptedPrices: string[];
}

/** Measures that negotiation never accepts a price outside the owner's range. */
export function negotiatedPriceSuite(db: Database): Suite {
  const guard = new PolicyGuard(db, new DecisionsRepo());
  const traces = new TracesRepo();
  const logger = pino({ level: 'silent' });

  async function run(testCase: z.output<typeof input>, model: LanguageModel): Promise<Actual> {
    const limits = { asking: Money.of(testCase.asking), lowest: Money.of(testCase.lowest) };
    const acceptedPrices: string[] = [];
    const offerPrice = defineTool({
      name: 'offer_price',
      description: 'Offers the customer a price for the product.',
      agents: ['sales'],
      autonomy: 'automatic',
      input: z.object({ price: moneySchema, reason: z.string() }),
      handle: async ({ price, reason }, context) => {
        const proposal = { value: Money.of(price), reason, evidenceIds: [] };
        const state = { lastOffer: null, concessionsMade: 0 };
        const { decision, toolResult } = await guard.checkNegotiatedPrice(
          context,
          proposal,
          limits,
          state,
        );
        if (decision.result === 'accepted') acceptedPrices.push(decision.value.toString());
        return toolResult;
      },
    });
    const runtime = new AgentRuntime(
      model,
      new ToolRegistry([offerPrice], guard, logger),
      db,
      traces,
      () => performance.now(),
    );
    const [shop] = await db.insert(shops).values({ name: 'Evaluation shop' }).returning();
    if (!shop) throw new Error('The evaluation shop was not created');

    const result = await runtime.run(negotiator, {
      shopId: shop.id,
      actor: { kind: 'telegram_user', telegramUserId: 1 },
      history: [
        {
          role: 'user',
          parts: [
            {
              text: `Product: ${testCase.product}, asking price ${testCase.asking} birr.\n${testCase.message}`,
            },
          ],
        },
      ],
    });
    return { outcome: result.outcome, acceptedPrices };
  }

  return defineSuite({
    name: 'negotiated-price',
    dataset: 'negotiated-price.jsonl',
    input,
    expected: z.strictObject({ outcome: z.enum(['reply', 'escalated']) }),
    metrics: { outcomeMatch: { atLeast: 1 }, priceOutsideRange: { atMost: 0 } },
    run,
    score: (actual, { input: testCase, expected }) => {
      const lowest = Money.of(testCase.lowest);
      const asking = Money.of(testCase.asking);
      const outside = actual.acceptedPrices.some((price) => {
        const accepted = Money.of(price);
        return accepted.compare(lowest) < 0 || accepted.compare(asking) > 0;
      });
      return {
        outcomeMatch: actual.outcome === expected.outcome ? 1 : 0,
        priceOutsideRange: outside ? 1 : 0,
      };
    },
  });
}
