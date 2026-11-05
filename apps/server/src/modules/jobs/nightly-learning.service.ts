import type { Logger } from 'pino';
import type { TelegramUpdatesRepo } from '../../telegram/updates.repo';
import type { CustomersService } from '../customers/customers.service';
import type { ZoneFactorService } from '../delivery/zone-factors.service';
import type { AcceptanceFactorService } from '../far-quotes/acceptance-factors.service';
import type { OrderService } from '../orders/orders.service';

/** The design doc's rule: exact delivery coordinates are kept for seven days, then only zones. */
const PIN_RETENTION_MS = 7 * 24 * 60 * 60_000;

// A type alias, not an interface, so it fits the jobs' `Record<string, number>` summary type.
type NightlySummary = {
  legs: number;
  zones: number;
  estimateErrorPercent: number;
  learnedErrorPercent: number;
  shops: number;
  acceptanceZones: number;
  orderPinsForgotten: number;
  pendingPinsForgotten: number;
  updatesDeleted: number;
};

/**
 * The `nightly-learning` job, which the cron service calls at 2:00 in Addis Ababa: it learns the
 * zone factors from finished trips, measures how well they estimated the last two weeks, and
 * forgets exact delivery locations older than a week. It is platform-wide and safe to run twice,
 * so a fixed cron call fits it better than a chain of per-shop timers.
 */
export class NightlyLearningService {
  constructor(
    private readonly timeFactors: Pick<ZoneFactorService, 'learn'>,
    private readonly acceptance: Pick<AcceptanceFactorService, 'learnAll'>,
    private readonly orders: Pick<OrderService, 'forgetPinsBefore'>,
    private readonly customers: Pick<CustomersService, 'forgetPendingPinsBefore'>,
    private readonly updates: Pick<TelegramUpdatesRepo, 'deleteProcessedBefore'>,
    private readonly logger: Logger,
    private readonly now: () => Date,
  ) {}

  async run(): Promise<NightlySummary> {
    const before = new Date(this.now().getTime() - PIN_RETENTION_MS);
    const summary = {
      ...(await this.timeFactors.learn()),
      ...(await this.acceptance.learnAll()),
      orderPinsForgotten: await this.orders.forgetPinsBefore(before),
      pendingPinsForgotten: await this.customers.forgetPendingPinsBefore(before),
      updatesDeleted: await this.updates.deleteProcessedBefore(before),
    };
    this.logger.info(summary, 'nightly learning finished');
    return summary;
  }
}
