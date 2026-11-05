import type { Database } from '../../db/client';
import { withShop } from '../../db/with-shop';
import type { DemandRepo } from './demand.repo';

/** What customers asked for and the shop could not sell them yet. */
export class DemandService {
  constructor(
    private readonly db: Database,
    private readonly repo: DemandRepo,
  ) {}

  /** Records a product the shop does not have, and returns the ID that **Notify me** carries. */
  recordUnmet(shopId: string, customerId: string, description: string): Promise<string> {
    return withShop(this.db, shopId, (tx) =>
      this.repo.insertSignal(tx, { shopId, customerId, description }),
    );
  }

  requestNotify(shopId: string, customerId: string, signalId: string): Promise<boolean> {
    return withShop(this.db, shopId, (tx) => this.repo.requestNotify(tx, signalId, customerId));
  }

  async joinWaitlist(shopId: string, customerId: string, variantId: string): Promise<void> {
    await withShop(this.db, shopId, (tx) =>
      this.repo.joinWaitlist(tx, { shopId, customerId, variantId }),
    );
  }
}
