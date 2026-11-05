import { sql, type SQL } from 'drizzle-orm';
import type { Database, Transaction } from '../../db/client';
import { weeklySuggestionRuns } from '../../db/schema';
import type { QueryRows } from './insights.domain';

type Cell = QueryRows['rows'][number][string];

export class InsightsRepo {
  constructor(private readonly db: Database) {}

  /** Runs a query that `checkQuery` accepted. Nothing else may reach this method. */
  checkedQuery(tx: Transaction, checkedSql: string): Promise<QueryRows> {
    return this.rows(tx, sql.raw(checkedSql));
  }

  /** Average fee, payout, and margin of delivered trips by distance. */
  deliveryMargins(tx: Transaction, since: Date): Promise<QueryRows> {
    return this.rows(
      tx,
      sql`select case
            when route_km <= 3 then '0-3 km'
            when route_km <= 6 then '3-6 km'
            when route_km <= 10 then '6-10 km'
            else 'over 10 km' end as distance,
          count(*)::integer as deliveries,
          round(avg(fees), 2) as average_fee,
          round(avg(payout), 2) as average_payout,
          round(avg(margin), 2) as average_margin
        from report_deliveries
        where status = 'delivered' and delivered_at >= ${iso(since)}
        group by 1
        order by min(route_km)`,
    );
  }

  /** Units sold and units still available by size. */
  sellThroughBySize(tx: Transaction, since: Date): Promise<QueryRows> {
    return this.rows(
      tx,
      sql`with sold as (
            select size, sum(quantity)::integer as units_sold
            from report_sales where sold_at >= ${iso(since)} group by size
          ), stock as (
            select size, sum(available)::integer as units_available
            from report_stock where active group by size
          )
        select coalesce(sold.size, stock.size) as size,
          coalesce(units_sold, 0) as units_sold,
          coalesce(units_available, 0) as units_available
        from sold full join stock on stock.size = sold.size
        order by units_sold desc, size
        limit 15`,
    );
  }

  /** What customers asked for by photo that the shop did not have. */
  unmetDemand(tx: Transaction, since: Date): Promise<QueryRows> {
    return this.rows(
      tx,
      sql`select description, count(*)::integer as requests,
          count(*) filter (where notify_requested)::integer as want_a_message
        from report_demand where created_at >= ${iso(since)}
        group by description order by requests desc limit 5`,
    );
  }

  /** Sold-out sizes with customers waiting. */
  waitlist(tx: Transaction): Promise<QueryRows> {
    return this.rows(
      tx,
      sql`select product_title, size, count(*)::integer as waiting
        from report_waitlist where not notified
        group by product_title, size order by waiting desc limit 5`,
    );
  }

  /** Shops with orders since `since`, through a function that returns only their IDs. */
  async shopsWithOrdersSince(since: Date): Promise<string[]> {
    const rows = await this.db.execute<{ shop_id: string }>(
      sql`select weekly_suggestion_shop_ids(${iso(since)}) as shop_id`,
    );
    return rows.map((row) => row.shop_id);
  }

  /** Returns false when the shop's suggestions for this week already ran. */
  async claimWeek(tx: Transaction, shopId: string, week: string): Promise<boolean> {
    const inserted = await tx
      .insert(weeklySuggestionRuns)
      .values({ shopId, week })
      .onConflictDoNothing()
      .returning({ week: weeklySuggestionRuns.week });
    return inserted.length > 0;
  }

  private async rows(tx: Transaction, query: SQL): Promise<QueryRows> {
    const result = await tx.execute(query);
    return {
      columns: result.columns.map((column) => column.name),
      rows: result.map((row) =>
        Object.fromEntries(Object.entries(row).map(([key, value]) => [key, cellOf(value)])),
      ),
    };
  }
}

/** Raw SQL parameters go to the driver as text, which it does not convert from a `Date`. */
function iso(instant: Date): SQL {
  return sql`${instant.toISOString()}::timestamptz`;
}

/** Postgres returns timestamps as dates and big counts as strings; JSON keeps both readable. */
function cellOf(value: unknown): Cell {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  return value === null || value === undefined ? null : JSON.stringify(value);
}
