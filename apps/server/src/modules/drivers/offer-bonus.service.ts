import { Money, type MoneyString } from '@buchi/shared';
import type { Database } from '../../db/client';
import { withShop } from '../../db/with-shop';
import type { DeliveryJobsRepo } from './delivery-jobs.repo';
import { bonusButtonText, raisedNotice, unansweredAlert } from './dispatch-messages.domain';
import { suggestedBonus } from './dispatch.domain';
import { jobCallbackData } from './drivers.schemas';
import type { JobOffers } from './job-offers.service';
import type { DeliveryOwnerAlerts } from './owner-alerts.service';

export type RaiseResult =
  { status: 'raised'; price: MoneyString } | { status: 'closed' | 'not_found' };

/**
 * When no driver takes a job, the owners get a bonus suggested by code. In Phase 6 the operations
 * agent suggests it instead.
 */
export class OfferBonusService {
  constructor(
    private readonly db: Database,
    private readonly jobs: DeliveryJobsRepo,
    private readonly offers: Pick<JobOffers, 'open' | 'close' | 'broadcast'>,
    private readonly alerts: Pick<DeliveryOwnerAlerts, 'send'>,
  ) {}

  /** The offer timer handler: an offer still open after 10 minutes needs the owners. */
  async offerUnanswered(timer: { targetId: string; shopId: string | null }): Promise<void> {
    const { shopId, targetId } = timer;
    if (shopId === null) throw new Error('An offer timer needs a shop');
    const open = await withShop(this.db, shopId, async (tx) => {
      const offer = await this.jobs.findOffer(tx, targetId);
      if (offer?.status !== 'open') return undefined;
      return { offer, stops: await this.jobs.stops(tx, offer.jobId) };
    });
    if (!open) return;
    const { offer, stops } = open;
    const bonus = suggestedBonus(Money.of(offer.price)).toString();
    await this.alerts.send(
      shopId,
      unansweredAlert({ orderIds: stops.map((s) => s.orderId), price: offer.price, bonus }),
      [{ text: bonusButtonText(bonus), data: jobCallbackData('bonus', offer.id) }],
    );
  }

  /**
   * Replaces the open offer with one at the payout plus the suggested bonus, computed again from
   * the offer so the owner gets exactly what the button said.
   */
  async raise(ownerShopIds: string[], offerId: string): Promise<RaiseResult> {
    for (const shopId of ownerShopIds) {
      const outcome = await withShop(this.db, shopId, async (tx) => {
        const offer = await this.jobs.findOffer(tx, offerId);
        if (!offer) return undefined;
        // A special offer's price rises only within the owner's cap, never by a bonus.
        if ((await this.jobs.findJob(tx, offer.jobId))?.special) return 'closed' as const;
        if (!(await this.jobs.expireOffer(tx, offerId))) return 'closed' as const;
        const price = Money.of(offer.price).add(suggestedBonus(Money.of(offer.price)));
        return this.offers.open(tx, {
          shopId,
          jobId: offer.jobId,
          price: price.toString(),
          raiseStep: offer.raiseStep + 1,
        });
      });
      if (outcome === undefined) continue;
      if (outcome === 'closed') return { status: 'closed' };
      await this.offers.close(shopId, offerId, raisedNotice);
      await this.offers.broadcast(shopId, outcome);
      return { status: 'raised', price: outcome.price };
    }
    return { status: 'not_found' };
  }
}
