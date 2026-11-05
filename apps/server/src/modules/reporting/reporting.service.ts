import type { Database } from '../../db/client';
import { isQueryTimeout, queryMistake } from '../../db/errors';
import { withReportReader } from '../../db/with-report-reader';
import { withShop } from '../../db/with-shop';
import { AppError } from '../../shared/errors';
import { weekOf, type QueryRows } from './reporting.domain';
import type { ReportingRepo } from './reporting.repo';
import { checkQuery, MAX_ROWS } from './sql-guard.domain';

/** The weekly analysis looks back four weeks, enough trips and sales for an average. */
export const WEEKLY_PERIOD_DAYS = 28;
const DAY_MS = 24 * 60 * 60_000;

/** The fixed analysis queries behind the weekly suggestions, with the period they cover. */
export interface WeeklyFindings {
  periodDays: number;
  deliveryMargins: QueryRows;
  sellThroughBySize: QueryRows;
  unmetDemand: QueryRows;
  waitlist: QueryRows;
}

/**
 * Read-only answers about a shop's business. Every query runs as `report_reader` in a read-only
 * transaction with a three-second timeout, and a model-written one only after `checkQuery`.
 */
export class ReportingService {
  constructor(
    private readonly db: Database,
    private readonly repo: ReportingRepo,
    private readonly now: () => Date,
  ) {}

  /** A refused or failing query becomes an error the model can read and fix. */
  async ask(shopId: string, query: string): Promise<QueryRows> {
    const checked = checkQuery(query);
    if (checked.status === 'rejected') throw new AppError('VALIDATION_FAILED', checked.reason);
    try {
      const result = await withReportReader(this.db, shopId, (tx) =>
        this.repo.checkedQuery(tx, checked.sql),
      );
      // A UNION's LIMIT may bind to its last part only, so the rows are capped here as well.
      return { columns: result.columns, rows: result.rows.slice(0, MAX_ROWS) };
    } catch (err) {
      if (isQueryTimeout(err)) {
        throw new AppError('CONFLICT', 'The query took longer than 3 seconds. Make it simpler.');
      }
      const mistake = queryMistake(err);
      if (mistake) throw new AppError('VALIDATION_FAILED', `The database refused it: ${mistake}`);
      throw err;
    }
  }

  weeklyFindings(shopId: string): Promise<WeeklyFindings> {
    const since = this.periodStart();
    return withReportReader(this.db, shopId, async (tx) => ({
      periodDays: WEEKLY_PERIOD_DAYS,
      deliveryMargins: await this.repo.deliveryMargins(tx, since),
      sellThroughBySize: await this.repo.sellThroughBySize(tx, since),
      unmetDemand: await this.repo.unmetDemand(tx, since),
      waitlist: await this.repo.waitlist(tx),
    }));
  }

  shopsForWeeklySuggestions(): Promise<string[]> {
    return this.repo.shopIds();
  }

  /** Returns false when this week's suggestions for the shop already ran, so they run once. */
  claimWeek(shopId: string): Promise<boolean> {
    return withShop(this.db, shopId, (tx) => this.repo.claimWeek(tx, shopId, weekOf(this.now())));
  }

  private periodStart(): Date {
    return new Date(this.now().getTime() - WEEKLY_PERIOD_DAYS * DAY_MS);
  }
}
