import { Money, type MoneyString } from '@buchi/shared';
import type { Database } from '../../db/client';
import { withShop } from '../../db/with-shop';
import { AppError } from '../../shared/errors';
import type { DeliveryJobsRepo } from './delivery-jobs.repo';
import { raisedNotice } from './dispatch-messages.domain';
import type { JobOffers } from './job-offers.service';

export type RaiseResult = { status: 'raised'; price: MoneyString } | { status: 'closed' };

/**
 * When no driver takes a job, the operations agent proposes a bonus and the owner approves it.
 * The bonus replaces the open offer with a new one at the higher payout.
 */
export class OfferBonusService {
  constructor(
    private readonly db: Database,
    private readonly jobs: DeliveryJobsRepo,
    private readonly offers: Pick<JobOffers, 'open' | 'close' | 'broadcast'>,
  ) {}

  /** Returns `closed` when a driver took the job, or a bonus replaced the offer, in the meantime. */
  async raise(shopId: string, offerId: string, bonus: Money): Promise<RaiseResult> {
    const outcome = await withShop(this.db, shopId, async (tx) => {
      const offer = await this.jobs.findOffer(tx, offerId);
      if (!offer) throw new AppError('NOT_FOUND', 'There is no such job offer.');
      if (!(await this.jobs.expireOffer(tx, offerId))) return undefined;
      return this.offers.open(tx, {
        shopId,
        jobId: offer.jobId,
        price: Money.of(offer.price).add(bonus).toString(),
        raiseStep: offer.raiseStep + 1,
      });
    });
    if (!outcome) return { status: 'closed' };
    await this.offers.close(shopId, offerId, raisedNotice);
    await this.offers.broadcast(shopId, outcome);
    return { status: 'raised', price: outcome.price };
  }
}
