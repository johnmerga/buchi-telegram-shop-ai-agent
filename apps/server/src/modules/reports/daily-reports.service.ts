import type { DailyReportName } from '@buchi/shared';
import type { Logger } from 'pino';
import type { Database } from '../../db/client';
import { withShop } from '../../db/with-shop';
import { addisDay } from '../../shared/time';
import type { OwnerAlerts } from '../owner/owner-alerts.service';
import {
  eveningSummaryText,
  LOW_STOCK_UNITS,
  morningBriefText,
  type EveningSummary,
  type MorningBrief,
} from './daily-reports.domain';
import type { DailyReportsRepo } from './daily-reports.repo';
import { dailySummaryRow } from './ledger.domain';
import type { LedgerService } from './ledger.service';

// A type alias, not an interface, so it fits the jobs' `Record<string, number>` summary type.
type ReportsSummary = {
  sent: number;
  alreadySent: number;
  failed: number;
};

/** The design doc's window for unmet demand that the morning brief mentions. */
const NOTIFY_WINDOW_MS = 7 * 24 * 60 * 60_000;

const kinds = { 'evening-summary': 'evening_summary', 'morning-brief': 'morning_brief' } as const;

/**
 * The evening summary and the morning brief for each shop's owners. The cron calls send each
 * report once per shop and Addis Ababa day, so a repeated call sends nothing twice. **Run now**
 * sends a shop's report again on request, without touching the day's ledger row.
 */
export class DailyReports {
  constructor(
    private readonly db: Database,
    private readonly repo: DailyReportsRepo,
    private readonly alerts: Pick<OwnerAlerts, 'send'>,
    private readonly ledger: Pick<LedgerService, 'enqueue'>,
    private readonly logger: Logger,
    private readonly now: () => Date,
  ) {}

  /** The `evening-summary` job, at 6:00 PM in Addis Ababa. */
  eveningSummaries(): Promise<ReportsSummary> {
    return this.forEveryShop('evening-summary');
  }

  /** The `morning-brief` job, at 8:00 AM in Addis Ababa. */
  morningBriefs(): Promise<ReportsSummary> {
    return this.forEveryShop('morning-brief');
  }

  async runNow(shopId: string, name: DailyReportName): Promise<void> {
    await this.alerts.send(shopId, (await this.report(shopId, name)).text);
  }

  private async forEveryShop(name: DailyReportName): Promise<ReportsSummary> {
    const summary: ReportsSummary = { sent: 0, alreadySent: 0, failed: 0 };
    const { day } = addisDay(this.now());
    for (const shopId of await this.repo.shopIds(this.db)) {
      try {
        const report = await this.report(shopId, name);
        const claimed = await withShop(this.db, shopId, (tx) =>
          this.repo.claimRun(tx, shopId, kinds[name], day),
        );
        if (!claimed) {
          summary.alreadySent += 1;
          continue;
        }
        if (report.kind === 'evening') {
          await this.ledger.enqueue(shopId, dailySummaryRow(report.data));
        }
        await this.alerts.send(shopId, report.text);
        summary.sent += 1;
      } catch (err) {
        this.logger.error({ err, shopId, report: name }, 'daily report failed');
        summary.failed += 1;
      }
    }
    return summary;
  }

  private async report(
    shopId: string,
    name: DailyReportName,
  ): Promise<
    { kind: 'evening'; data: EveningSummary; text: string } | { kind: 'morning'; text: string }
  > {
    if (name === 'evening-summary') {
      const data = await this.eveningSummary(shopId);
      return { kind: 'evening', data, text: eveningSummaryText(data) };
    }
    return { kind: 'morning', text: morningBriefText(await this.morningBrief(shopId)) };
  }

  private eveningSummary(shopId: string): Promise<EveningSummary> {
    const today = addisDay(this.now());
    return withShop(this.db, shopId, async (tx) => {
      const paid = await this.repo.ordersPaid(tx, today);
      const deliveries = await this.repo.deliveries(tx, today);
      const fraud = await this.repo.fraudBlocked(tx, today);
      return {
        day: today.day,
        ordersCreated: await this.repo.ordersCreated(tx, today),
        ordersPaid: paid.count,
        revenue: paid.revenue,
        deliveryCost: deliveries.cost,
        saverSavings: deliveries.saverSavings,
        fraudBlocked: fraud.count,
        fraudBlockedAmount: fraud.amount,
        openReviews: await this.repo.openReviews(tx),
      };
    });
  }

  private morningBrief(shopId: string): Promise<MorningBrief> {
    const since = new Date(this.now().getTime() - NOTIFY_WINDOW_MS);
    return withShop(this.db, shopId, async (tx) => ({
      lowStock: await this.repo.lowStock(tx, LOW_STOCK_UNITS),
      openReviews: await this.repo.openReviews(tx),
      waitlist: await this.repo.waitlist(tx),
      notifyRequests: await this.repo.notifyRequests(tx, since),
    }));
  }
}
