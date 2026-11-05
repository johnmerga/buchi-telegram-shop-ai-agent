import type { Database } from '@buchi/server/db/client';
import type { Suite } from './harness/suite';
import { negotiatedPriceSuite } from './runners/negotiated-price';

/** Every suite the CLI runs, in report order. */
export function createSuites(db: Database): Suite[] {
  return [negotiatedPriceSuite(db)];
}
