import type { Database } from '../../db/client';
import { withShop } from '../../db/with-shop';
import type { CustomerFactsRepo } from './customer-facts.repo';

interface CustomerFact {
  key: string;
  fact: string;
}

/** What the sales agent remembers about a customer of one shop, and the way to forget it. */
export class CustomerMemoryService {
  constructor(
    private readonly db: Database,
    private readonly repo: CustomerFactsRepo,
  ) {}

  async remember(
    shopId: string,
    customerId: string,
    fact: CustomerFact & { sourceMessage: string },
  ): Promise<void> {
    await withShop(this.db, shopId, (tx) => this.repo.upsert(tx, { shopId, customerId, ...fact }));
  }

  async facts(shopId: string, customerId: string): Promise<CustomerFact[]> {
    const rows = await withShop(this.db, shopId, (tx) => this.repo.list(tx, customerId));
    return rows.map(({ key, fact }) => ({ key, fact }));
  }

  async forget(shopId: string, customerId: string): Promise<void> {
    await withShop(this.db, shopId, (tx) => this.repo.deleteAll(tx, customerId));
  }
}
