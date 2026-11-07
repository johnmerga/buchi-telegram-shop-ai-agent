import { Money, moneySchema } from '@buchi/shared';
import { FarPriceEstimator } from '@buchi/server/ai/agents/far-price/far-price-estimator';
import { DecisionsRepo } from '@buchi/server/ai/guard/decisions.repo';
import { PolicyGuard } from '@buchi/server/ai/guard/policy-guard.service';
import type { LanguageModel } from '@buchi/server/ai/language-model';
import { ToolRegistry } from '@buchi/server/ai/registry';
import { AgentRuntime } from '@buchi/server/ai/runtime';
import { TracesRepo } from '@buchi/server/ai/traces.repo';
import type { Database } from '@buchi/server/db/client';
import { AreaNotesRepo } from '@buchi/server/modules/delivery/area-notes.repo';
import { AreaNoteService } from '@buchi/server/modules/delivery/area-notes.service';
import { ZoneFactorsRepo } from '@buchi/server/modules/delivery/zone-factors.repo';
import { ZoneFactorService } from '@buchi/server/modules/delivery/zone-factors.service';
import { AcceptanceFactorService } from '@buchi/server/modules/far-quotes/acceptance-factors.service';
import { FarQuoteEvidence } from '@buchi/server/modules/far-quotes/far-quote-evidence.service';
import { FarQuotesRepo } from '@buchi/server/modules/far-quotes/far-quotes.repo';
import { scaled, statisticalPrice } from '@buchi/server/modules/far-quotes/far-quotes.domain';
import { syntheticTrips } from '@buchi/server/modules/far-quotes/synthetic-trips.domain';
import { ShopsRepo } from '@buchi/server/modules/shops/shops.repo';
import { ShopsService } from '@buchi/server/modules/shops/shops.service';
import { pino } from 'pino';
import { z } from 'zod';
import { defineSuite, type Suite } from '../harness/suite';
import { evalShop } from './far-price-shop';

/** Every case draws from the same 200 synthetic trips per seed, as the demo seeder does. */
const TRIPS = 200;

const input = z.strictObject({
  seed: z.number().int().nonnegative(),
  /** The trip to price. The trips before it are its history. */
  trip: z
    .number()
    .int()
    .min(1)
    .max(TRIPS - 1),
  /**
   * The owner changed the delivery settings after the history: the trip's formula payout is
   * `scale` times what it was, and the cap is `cap`. Past trips keep their old prices in birr, so
   * only their multiples of the formula still apply.
   */
  retuned: z.strictObject({ scale: z.number().positive().max(1), cap: moneySchema }).optional(),
});

interface Actual {
  source: 'agent' | 'statistics';
  price: string;
  statisticsPrice: string;
  heldPrice: string;
  /** The held price under today's settings, which both estimates are measured against. */
  fairPrice: string;
  outsideLimits: boolean;
}

const offline = () => Promise.reject(new Error('Evaluations do not call Telegram'));

/**
 * The far-price agent on a synthetic trip, with every older synthetic trip as its history: its
 * first price against the price a driver held, next to the statistics alone.
 */
export function farPriceAgentSuite(db: Database): Suite {
  const logger = pino({ level: 'silent' });
  const clock = () => evalShop.now;
  const shops = new ShopsService(db, new ShopsRepo(db), { verifyPostingRights: offline });
  const acceptance = new AcceptanceFactorService(db, new FarQuotesRepo(), clock);
  const evidence = new FarQuoteEvidence(
    new ZoneFactorService(new ZoneFactorsRepo(db), clock),
    acceptance,
    new AreaNoteService(db, new AreaNotesRepo(), clock),
    clock,
  );
  const guard = new PolicyGuard(db, new DecisionsRepo());

  async function run(testCase: z.output<typeof input>, model: LanguageModel): Promise<Actual> {
    const trips = syntheticTrips({ ...evalShop, count: TRIPS, seed: testCase.seed });
    const target = trips[testCase.trip];
    if (!target)
      throw new Error(`Seed ${String(testCase.seed)} has no trip ${String(testCase.trip)}`);
    const shopId = await shops.create(1, { name: 'Evaluation shop' });
    await acceptance.addSynthetic(
      shopId,
      trips.slice(0, testCase.trip).map((trip) => trip.far),
    );
    await acceptance.learnAll();

    const { far } = target;
    const { retuned } = testCase;
    const scale = retuned?.scale ?? 1;
    const payout = scaled(Money.of(far.formulaPayout), scale);
    const cap = Money.of(retuned?.cap ?? far.cap);
    const facts = await evidence.build(shopId, target.destination, {
      payout,
      meters: far.routeMeters,
      expectedMinutes: Math.round(far.routingSeconds / 60),
      legs: [{ routingSeconds: far.routingSeconds, expectedSeconds: far.routingSeconds }],
      approximate: false,
      cap,
    });
    const estimator = new FarPriceEstimator(
      (tools) =>
        new AgentRuntime(model, new ToolRegistry(tools, guard, logger), db, new TracesRepo(), () =>
          performance.now(),
        ),
      guard,
      logger,
    );
    const estimate = await estimator.estimate({ shopId, evidence: facts, cap });
    return {
      source: estimate.source,
      price: estimate.price.toString(),
      statisticsPrice: statisticalPrice(payout, facts.acceptanceFactor.value).toString(),
      heldPrice: far.heldPrice,
      fairPrice: scaled(Money.of(far.heldPrice), scale).toString(),
      outsideLimits:
        estimate.price.compare(payout) < 0 ||
        (estimate.price.compare(cap) > 0 && !estimate.needsOwner),
    };
  }

  const error = (estimate: string, actual: string) =>
    Math.abs(Number(estimate) - Number(actual)) / Number(actual);

  return defineSuite({
    name: 'far-price-agent',
    dataset: 'far-price-agent.jsonl',
    input,
    expected: z.strictObject({ heldPrice: moneySchema }),
    metrics: {
      agentAnswered: { atLeast: 0.9 },
      agentError: { atMost: 0.12 },
      statisticsError: { atMost: 0.15 },
      priceOutsideLimits: { atMost: 0 },
    },
    run,
    score: (actual, { expected }) => {
      // The dataset names the held price, so a change to the synthetic trips cannot pass unseen.
      if (Money.of(expected.heldPrice).compare(Money.of(actual.heldPrice)) !== 0) {
        throw new Error(`The synthetic trip now has a held price of ${actual.heldPrice}`);
      }
      return {
        agentAnswered: actual.source === 'agent' ? 1 : 0,
        agentError: error(actual.price, actual.fairPrice),
        statisticsError: error(actual.statisticsPrice, actual.fairPrice),
        priceOutsideLimits: actual.outsideLimits ? 1 : 0,
      };
    },
  });
}
