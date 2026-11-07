import type { Database } from '../../db/client';
import { withShop } from '../../db/with-shop';
import type { ZoneFactorService } from '../delivery/zone-factors.service';
import type { AcceptanceFactorService } from '../far-quotes/acceptance-factors.service';
import type { DemoRepo, ResetCounts } from './demo.repo';
import { DEMO_AREA_NOTES } from './demo-shop.domain';

/**
 * Removes a shop's demo data and leaves the owner's own rows as they were. The learned factors
 * are learned again, so they no longer count the demo trips.
 */
export class DemoReset {
  constructor(
    private readonly db: Database,
    private readonly repo: DemoRepo,
    private readonly zoneFactors: Pick<ZoneFactorService, 'removeSyntheticLegs' | 'learn'>,
    private readonly acceptance: Pick<AcceptanceFactorService, 'learnAll'>,
  ) {}

  async reset(shopId: string): Promise<ResetCounts> {
    const { counts, removedIds } = await withShop(this.db, shopId, (tx) =>
      this.repo.deleteShopRows(
        tx,
        DEMO_AREA_NOTES.map((note) => note.note),
      ),
    );
    await this.repo.deleteTimers(this.db, removedIds);
    // Road legs are platform-wide and hold no shop, so every seeded leg goes.
    await this.zoneFactors.removeSyntheticLegs();
    await this.zoneFactors.learn();
    await this.acceptance.learnAll();
    return counts;
  }
}
