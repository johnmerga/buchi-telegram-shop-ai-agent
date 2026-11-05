import type { Database, Transaction } from '../../db/client';
import { withShop } from '../../db/with-shop';
import type { ResolvedRule } from './rules.domain';
import type { OwnerRulesRepo } from './rules.repo';
import { promotionParametersSchema, type PromotionParameters } from './rules.schemas';

/**
 * The owner's confirmed rules, and the reads that the services they affect make: checkout asks
 * whether deliveries are paused, and order pricing asks for the promotions in force.
 */
export class OwnerRulesService {
  constructor(
    private readonly db: Database,
    private readonly repo: OwnerRulesRepo,
    private readonly now: () => Date,
  ) {}

  async record(shopId: string, rule: ResolvedRule, confirmedBy: number): Promise<string> {
    return withShop(this.db, shopId, (tx) =>
      this.repo.insert(tx, {
        shopId,
        type: rule.type,
        parameters: rule.parameters,
        startsAt: rule.startsAt,
        endsAt: rule.endsAt,
        confirmedBy,
      }),
    );
  }

  async deliveryPaused(shopId: string): Promise<boolean> {
    const pauses = await withShop(this.db, shopId, (tx) =>
      this.repo.activeParameters(tx, 'delivery_pause', this.now()),
    );
    return pauses.length > 0;
  }

  /** Read in the caller's transaction, so an order is priced with the promotions it sees. */
  async activePromotions(tx: Transaction): Promise<PromotionParameters[]> {
    const rows = await this.repo.activeParameters(tx, 'promotion', this.now());
    return rows.map((parameters) => promotionParametersSchema.parse(parameters));
  }
}
