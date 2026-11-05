import type { Database } from '../../db/client';
import { withShop } from '../../db/with-shop';
import type { EventBus } from '../../shared/events';
import type { DemandRepo } from './demand.repo';

/** What customers asked for and the shop could not sell them yet. */
export class DemandService {
  constructor(
    private readonly db: Database,
    private readonly repo: DemandRepo,
    private readonly events: Pick<EventBus, 'publish'>,
  ) {}

  /**
   * Records a product the shop does not have, with its description's embedding for matching new
   * products, and returns the ID that **Notify me** carries.
   */
  recordUnmet(
    shopId: string,
    customerId: string,
    request: { description: string; embedding: number[] },
  ): Promise<string> {
    return withShop(this.db, shopId, (tx) =>
      this.repo.insertSignal(tx, { shopId, customerId, ...request }),
    );
  }

  requestNotify(shopId: string, customerId: string, signalId: string): Promise<boolean> {
    return withShop(this.db, shopId, (tx) => this.repo.requestNotify(tx, signalId, customerId));
  }

  async joinWaitlist(shopId: string, customerId: string, variantId: string): Promise<void> {
    const waiting = await withShop(this.db, shopId, async (tx) => {
      const joined = await this.repo.joinWaitlist(tx, { shopId, customerId, variantId });
      return joined ? (await this.repo.waiting(tx, variantId)).length : undefined;
    });
    if (waiting !== undefined) {
      await this.events.publish('waitlist.joined', { shopId, variantId, waiting });
    }
  }

  /** The customers waiting for a sold-out variant, in the order they joined. */
  waitingCustomers(shopId: string, variantId: string): Promise<string[]> {
    return withShop(this.db, shopId, (tx) => this.repo.waiting(tx, variantId));
  }

  /** The customer leaves the line once told, so they are told only once. */
  async markNotified(shopId: string, variantId: string, customerId: string): Promise<void> {
    await withShop(this.db, shopId, (tx) => this.repo.markNotified(tx, variantId, customerId));
  }

  /** The customers whose **Notify me** request a product with this embedding answers. */
  claimSimilarRequests(shopId: string, embedding: number[], maxDistance: number) {
    return withShop(this.db, shopId, (tx) =>
      this.repo.claimSimilarRequests(tx, embedding, maxDistance),
    );
  }
}
