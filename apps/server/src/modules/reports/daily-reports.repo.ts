import type { MoneyString } from '@buchi/shared';
import { and, count, desc, eq, gte, inArray, isNull, lt, lte, or, sql, sum } from 'drizzle-orm';
import type { Database, Transaction } from '../../db/client';
import {
  agentDecisions,
  dailyReportRuns,
  deliveryJobs,
  demandSignals,
  orderEvents,
  orders,
  paymentProofs,
  products,
  productVariants,
  waitlist,
} from '../../db/schema';
import type { LowStockItem, WaitlistDemand } from './daily-reports.domain';

type DailyReportKind = (typeof dailyReportRuns.$inferInsert)['kind'];

interface Period {
  start: Date;
  end: Date;
}

/** Postgres returns `null` for the sum of no rows. */
const money = (value: string | null): MoneyString => value ?? '0.00';

/**
 * Read-only reporting queries across the shop's orders, payments, deliveries, and stock, like the
 * order board's. Every query except `shopIds` runs inside `withShop`.
 */
export class DailyReportsRepo {
  /**
   * Looks across all shops, which row-level security blocks, through the `report_shop_ids`
   * database function. It returns only shop IDs.
   */
  async shopIds(db: Database): Promise<string[]> {
    const rows = await db.execute<{ shop_id: string }>(
      sql`select shop_id from report_shop_ids() as shop_id`,
    );
    return rows.map((row) => row.shop_id);
  }

  /** Records that a report went out today. Returns false when it already had. */
  async claimRun(
    tx: Transaction,
    shopId: string,
    kind: DailyReportKind,
    day: string,
  ): Promise<boolean> {
    const inserted = await tx
      .insert(dailyReportRuns)
      .values({ shopId, kind, day })
      .onConflictDoNothing()
      .returning({ day: dailyReportRuns.day });
    return inserted.length > 0;
  }

  async ordersCreated(tx: Transaction, period: Period): Promise<number> {
    const [row] = await tx
      .select({ count: count() })
      .from(orders)
      .where(within(orders.createdAt, period));
    return row?.count ?? 0;
  }

  /** Orders whose payment was approved in the period, and what they sold for. */
  async ordersPaid(
    tx: Transaction,
    period: Period,
  ): Promise<{ count: number; revenue: MoneyString }> {
    const [row] = await tx
      .select({ count: count(), revenue: sum(orders.total) })
      .from(orderEvents)
      .innerJoin(orders, eq(orders.id, orderEvents.orderId))
      .where(
        and(
          eq(orderEvents.toStatus, 'paid'),
          inArray(orderEvents.fromStatus, ['verifying', 'needs_review']),
          within(orderEvents.createdAt, period),
        ),
      );
    return { count: row?.count ?? 0, revenue: money(row?.revenue ?? null) };
  }

  /** Driver payouts of trips delivered in the period, and what grouping Saver orders saved. */
  async deliveries(
    tx: Transaction,
    period: Period,
  ): Promise<{ trips: number; cost: MoneyString; saverSavings: MoneyString }> {
    const [row] = await tx
      .select({
        trips: count(),
        cost: sum(deliveryJobs.payout),
        saverSavings: sql<
          string | null
        >`sum(${deliveryJobs.separateTripsPayout} - ${deliveryJobs.payout})`,
      })
      .from(deliveryJobs)
      .where(and(eq(deliveryJobs.status, 'delivered'), within(deliveryJobs.deliveredAt, period)));
    return {
      trips: row?.trips ?? 0,
      cost: money(row?.cost ?? null),
      saverSavings: money(row?.saverSavings ?? null),
    };
  }

  /** Screenshots that Buchi or the owner rejected, and the amounts they claimed. */
  async fraudBlocked(
    tx: Transaction,
    period: Period,
  ): Promise<{ count: number; amount: MoneyString }> {
    const [row] = await tx
      .select({ count: count(), amount: sum(paymentProofs.amount) })
      .from(paymentProofs)
      .where(
        and(
          or(eq(paymentProofs.decision, 'reject'), eq(paymentProofs.ownerDecision, 'rejected')),
          within(paymentProofs.createdAt, period),
        ),
      );
    return { count: row?.count ?? 0, amount: money(row?.amount ?? null) };
  }

  /** Payments in review and agent actions that wait for the owner. */
  async openReviews(tx: Transaction): Promise<number> {
    const [payments] = await tx
      .select({ count: count() })
      .from(orders)
      .where(eq(orders.status, 'needs_review'));
    const [decisions] = await tx
      .select({ count: count() })
      .from(agentDecisions)
      .where(eq(agentDecisions.ownerStatus, 'pending'));
    return (payments?.count ?? 0) + (decisions?.count ?? 0);
  }

  /** Sizes of products on sale with `units` or fewer left to sell, the emptiest first. */
  lowStock(tx: Transaction, units: number): Promise<LowStockItem[]> {
    const available = sql<number>`(${productVariants.stock} - ${productVariants.reserved})::int`;
    return tx
      .select({ title: products.title, size: productVariants.size, available })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(and(eq(products.active, true), lte(available, units)))
      .orderBy(available, products.title, productVariants.size);
  }

  /** Sizes that customers wait for and have not been told about yet, the longest line first. */
  waitlist(tx: Transaction): Promise<WaitlistDemand[]> {
    const waiting = count(waitlist.id);
    return tx
      .select({ title: products.title, size: productVariants.size, waiting })
      .from(waitlist)
      .innerJoin(productVariants, eq(productVariants.id, waitlist.variantId))
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(isNull(waitlist.notifiedAt))
      .groupBy(products.title, productVariants.id)
      .orderBy(desc(waiting), products.title);
  }

  async notifyRequests(tx: Transaction, since: Date): Promise<number> {
    const [row] = await tx
      .select({ count: count() })
      .from(demandSignals)
      .where(and(eq(demandSignals.notifyRequested, true), gte(demandSignals.createdAt, since)));
    return row?.count ?? 0;
  }
}

function within(column: Parameters<typeof gte>[0], period: Period) {
  return and(gte(column, period.start), lt(column, period.end));
}
