import type { Database } from '@buchi/server/db/client';
import type { Suite } from './harness/suite';
import { farPriceAgentSuite } from './runners/far-price-agent';
import { farPriceStatisticsSuite } from './runners/far-price-statistics';
import { negotiatedPriceSuite } from './runners/negotiated-price';
import { operationsSituationsSuite } from './runners/operations-situations';
import { ownerCommandsSuite } from './runners/owner-commands';
import { ownerQuestionsSuite } from './runners/owner-questions';

/** Every suite the CLI runs, in report order. */
export function createSuites(db: Database): Suite[] {
  return [
    negotiatedPriceSuite(db),
    operationsSituationsSuite(db),
    farPriceStatisticsSuite(),
    farPriceAgentSuite(db),
    ownerCommandsSuite(db),
    ownerQuestionsSuite(db),
  ];
}
