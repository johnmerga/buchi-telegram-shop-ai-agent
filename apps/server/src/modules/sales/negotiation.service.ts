import { Money } from '@buchi/shared';
import type { NegotiationState } from '../../ai/guard/negotiated-price.domain';
import type { Database, Transaction } from '../../db/client';
import { withShop } from '../../db/with-shop';
import type { AgreedPrices } from '../orders/orders.service';
import type { NegotiationsRepo } from './negotiations.repo';

interface NegotiationKey {
  shopId: string;
  customerId: string;
  productId: string;
}

/** The price talk between the sales agent and one customer about one negotiable product. */
export class NegotiationService implements AgreedPrices {
  constructor(
    private readonly db: Database,
    private readonly repo: NegotiationsRepo,
  ) {}

  /** What the agent already offered, which the policy guard holds it to. */
  async state({ shopId, customerId, productId }: NegotiationKey): Promise<NegotiationState> {
    const row = await withShop(this.db, shopId, (tx) => this.repo.find(tx, customerId, productId));
    return {
      lastOffer: row ? Money.of(row.agreedPrice) : null,
      concessionsMade: row?.concessionsMade ?? 0,
    };
  }

  /** Stores a price the policy guard accepted. The customer buys at it by confirming the order. */
  async recordOffer(key: NegotiationKey, price: Money, concession: boolean): Promise<void> {
    await withShop(this.db, key.shopId, async (tx) => {
      const current = await this.repo.find(tx, key.customerId, key.productId);
      const concessionsMade = (current?.concessionsMade ?? 0) + (concession ? 1 : 0);
      await this.repo.saveOffer(tx, { ...key, agreedPrice: price.toString(), concessionsMade });
    });
  }

  /** How many customers talked price for this product since a time, as demand evidence. */
  customersAskedSince(shopId: string, productId: string, since: Date): Promise<number> {
    return withShop(this.db, shopId, (tx) => this.repo.countCustomersSince(tx, productId, since));
  }

  async find(tx: Transaction, customerId: string, productId: string): Promise<Money | undefined> {
    const row = await this.repo.find(tx, customerId, productId);
    return row ? Money.of(row.agreedPrice) : undefined;
  }

  async take(tx: Transaction, customerId: string, productId: string): Promise<Money | undefined> {
    const price = await this.repo.take(tx, customerId, productId);
    return price === undefined ? undefined : Money.of(price);
  }
}
