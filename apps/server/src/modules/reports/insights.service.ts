import type { Insights } from '@buchi/shared';
import type { Database } from '../../db/client';
import { withShop } from '../../db/with-shop';
import type { DailyReportsRepo } from './daily-reports.repo';
import type { InsightsRepo } from './insights.repo';

/** The window of the **Insights** screen: long enough to smooth one quiet week. */
const INSIGHT_DAYS = 30;

/**
 * The design doc's success metrics that Buchi has data for. The first-reply time is not recorded,
 * so the screen says so instead of showing an estimate.
 */
export class InsightsService {
  constructor(
    private readonly db: Database,
    private readonly repo: InsightsRepo,
    private readonly daily: Pick<DailyReportsRepo, 'deliveries' | 'fraudBlocked'>,
    private readonly now: () => Date,
  ) {}

  insights(shopId: string): Promise<Insights> {
    const end = this.now();
    const since = new Date(end.getTime() - INSIGHT_DAYS * 24 * 60 * 60_000);
    const period = { start: since, end };
    return withShop(this.db, shopId, async (tx) => {
      const deliveries = await this.daily.deliveries(tx, period);
      return {
        days: INSIGHT_DAYS,
        autoApprovedPayments: await this.repo.autoApprovedPayments(tx, since),
        fraudBlocked: await this.daily.fraudBlocked(tx, period),
        farQuotesDriverFound: await this.repo.farQuotesDriverFound(tx, since),
        delivery: {
          trips: deliveries.trips,
          cost: deliveries.cost,
          saverSavings: deliveries.saverSavings,
        },
        guard: await this.repo.guardResults(tx, since),
        posts: await this.repo.postResults(tx),
      };
    });
  }
}
