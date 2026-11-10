import { Money } from '@buchi/shared';
import type { NegotiationState } from '../../ai/guard/negotiated-price.domain';
import type { Database, Transaction } from '../../db/client';
import { withShop } from '../../db/with-shop';
import type { AgreedPrices } from '../orders/orders.service';
import type { NegotiationsRepo } from './negotiations.repo';

/**
 * How long price talk counts as one negotiation. A customer who comes back later starts a new one
 * with fresh concessions, still from the agent's last offer and never below the owner's lowest
 * price; without this, two concessions made once left the agent unable to move for good.
 */
export const NEGOTIATION_RESET_MS = 6 * 60 * 60 * 1000;

/** The concessions that still count: none once the talk has been quiet for the reset time. */
export function concessionsInPlay(
  row: { concessionsMade: number; updatedAt: Date },
  now: Date,
): number {
  return now.getTime() - row.updatedAt.getTime() >= NEGOTIATION_RESET_MS ? 0 : row.concessionsMade;
}

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
  async state(
    { shopId, customerId, productId }: NegotiationKey,
    now = new Date(),
  ): Promise<NegotiationState> {
    const row = await withShop(this.db, shopId, (tx) => this.repo.find(tx, customerId, productId));
    return {
      lastOffer: row ? Money.of(row.agreedPrice) : null,
      concessionsMade: row ? concessionsInPlay(row, now) : 0,
    };
  }

  /** Stores a price the policy guard accepted. The customer buys at it by confirming the order. */
  async recordOffer(
    key: NegotiationKey,
    price: Money,
    concession: boolean,
    now = new Date(),
  ): Promise<void> {
    await withShop(this.db, key.shopId, async (tx) => {
      const current = await this.repo.find(tx, key.customerId, key.productId);
      const concessionsMade =
        (current ? concessionsInPlay(current, now) : 0) + (concession ? 1 : 0);
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
