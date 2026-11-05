import { Money } from '@buchi/shared';
import {
  learnFactors,
  lookupFactor,
  meanAbsoluteError,
  timeBand,
  type LearnedFactor,
} from '@buchi/server/modules/delivery/factors.domain';
import { timeFactorZones } from '@buchi/server/modules/delivery/zones.domain';
import {
  acceptanceFactorZones,
  statisticalPrice,
} from '@buchi/server/modules/far-quotes/far-quotes.domain';
import {
  syntheticTrips,
  type SyntheticTrip,
} from '@buchi/server/modules/far-quotes/synthetic-trips.domain';
import { z } from 'zod';
import { defineSuite, type Suite } from '../harness/suite';
import { evalShop } from './far-price-shop';

const input = z.strictObject({
  seed: z.number().int().nonnegative(),
  trips: z.number().int().min(20),
  /** The newest trips, which the factors learned from the older ones must predict. */
  holdout: z.number().int().min(1),
});

interface Actual {
  statisticsError: number;
  formulaError: number;
  timeError: number;
  routingError: number;
}

/**
 * Backtests the statistics alone, without a model: factors learned from the older synthetic trips
 * estimate the newer ones, as the nightly learning and the statistical fallback would have.
 */
export function farPriceStatisticsSuite(): Suite {
  return defineSuite({
    name: 'far-price-statistics',
    dataset: 'far-price-statistics.jsonl',
    input,
    expected: z.strictObject({}),
    metrics: {
      statisticsError: { atMost: 0.12 },
      statisticsBeatsFormula: { atLeast: 1 },
      timeError: { atMost: 0.15 },
      timeFactorBeatsRouting: { atLeast: 1 },
    },
    run: (testCase) => Promise.resolve(backtest(testCase)),
    score: (actual) => ({
      statisticsError: actual.statisticsError,
      statisticsBeatsFormula: actual.statisticsError < actual.formulaError ? 1 : 0,
      timeError: actual.timeError,
      timeFactorBeatsRouting: actual.timeError < actual.routingError ? 1 : 0,
    }),
  });
}

function backtest(testCase: z.output<typeof input>): Actual {
  const trips = syntheticTrips({ ...evalShop, count: testCase.trips, seed: testCase.seed });
  const split = trips.length - testCase.holdout;
  const training = trips.slice(0, split);
  const testing = trips.slice(split);
  const learnedAt = training.at(-1)?.leg.startedAt ?? evalShop.now;

  const acceptance = factorMap(
    learnFactors(
      training.map(({ far }) => ({
        ratio: Number(far.heldPrice) / Number(far.formulaPayout),
        at: far.at,
        zones: acceptanceFactorZones(far.zone).reverse(),
      })),
      learnedAt,
    ),
  );
  const timeFactors = (band: 'peak' | 'off_peak') =>
    factorMap(
      learnFactors(
        training
          .filter(({ leg }) => timeBand(leg.startedAt) === band)
          .map(({ leg }) => ({
            ratio: leg.actualSeconds / leg.routingSeconds,
            at: leg.startedAt,
            zones: timeFactorZones(leg.zone).reverse(),
          })),
        learnedAt,
      ),
    );
  const time = { peak: timeFactors('peak'), off_peak: timeFactors('off_peak') };

  const price = (trip: SyntheticTrip, factor: number) =>
    Number(statisticalPrice(Money.of(trip.far.formulaPayout), factor).toString());
  const held = (trip: SyntheticTrip) => Number(trip.far.heldPrice);
  return {
    statisticsError: meanAbsoluteError(
      testing.map((trip) => ({
        estimate: price(
          trip,
          lookupFactor(acceptanceFactorZones(trip.far.zone), acceptance).factor,
        ),
        actual: held(trip),
      })),
    ),
    formulaError: meanAbsoluteError(
      testing.map((trip) => ({ estimate: Number(trip.far.formulaPayout), actual: held(trip) })),
    ),
    timeError: meanAbsoluteError(
      testing.map(({ leg }) => ({
        estimate:
          leg.routingSeconds *
          lookupFactor(timeFactorZones(leg.zone), time[timeBand(leg.startedAt)]).factor,
        actual: leg.actualSeconds,
      })),
    ),
    routingError: meanAbsoluteError(
      testing.map(({ leg }) => ({ estimate: leg.routingSeconds, actual: leg.actualSeconds })),
    ),
  };
}

function factorMap(learned: LearnedFactor[]): Map<string, LearnedFactor> {
  return new Map(learned.map((factor) => [factor.zone, factor]));
}
