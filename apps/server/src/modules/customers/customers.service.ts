import type { Database } from '../../db/client';
import { withShop } from '../../db/with-shop';
import type { CustomerRow, CustomersRepo } from './customers.repo';

export class CustomersService {
  constructor(
    private readonly db: Database,
    private readonly repo: CustomersRepo,
  ) {}

  identify(shopId: string, telegramUserId: number, name: string): Promise<CustomerRow> {
    return withShop(this.db, shopId, (tx) =>
      this.repo.upsert(tx, { shopId, telegramUserId, name }),
    );
  }

  async setPhone(shopId: string, customerId: string, phone: string): Promise<void> {
    await withShop(this.db, shopId, (tx) => this.repo.setPhone(tx, customerId, phone));
  }
}
