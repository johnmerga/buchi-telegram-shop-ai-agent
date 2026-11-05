import type { Database } from '../../db/client';
import { withShop } from '../../db/with-shop';
import type { ReplyTimesRepo } from './reply-times.repo';

/** Records how long Buchi took to answer a customer's message, for the first-reply metric. */
export class ReplyTimes {
  constructor(
    private readonly db: Database,
    private readonly repo: ReplyTimesRepo,
  ) {}

  record(shopId: string, receivedAt: Date, repliedAt: Date): Promise<void> {
    return withShop(this.db, shopId, (tx) =>
      this.repo.insert(tx, { shopId, receivedAt, repliedAt }),
    );
  }
}
