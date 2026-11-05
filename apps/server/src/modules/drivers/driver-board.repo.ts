import type { MoneyString } from '@buchi/shared';
import { and, count, eq, inArray, sum } from 'drizzle-orm';
import type { Transaction } from '../../db/client';
import { deliveryJobs, jobOffers, jobStops } from '../../db/schema';

export interface OpenOfferRow {
  offerId: string;
  price: MoneyString;
  raiseStep: number;
  routeMeters: number;
  estimatedMinutes: number;
  stops: number;
}

export interface ActiveJobRow {
  jobId: string;
  status: 'assigned' | 'picked_up';
  payout: MoneyString;
}

/** Read-only queries for the driver Mini App. */
export class DriverBoardRepo {
  /**
   * Far-area offers stay in the chat for now: accepting one only holds it, and the Mini App's
   * accept endpoint takes a paid job.
   */
  openOffers(tx: Transaction): Promise<OpenOfferRow[]> {
    return tx
      .select({
        offerId: jobOffers.id,
        price: jobOffers.price,
        raiseStep: jobOffers.raiseStep,
        routeMeters: deliveryJobs.routeMeters,
        estimatedMinutes: deliveryJobs.estimatedMinutes,
        stops: count(jobStops.id),
      })
      .from(jobOffers)
      .innerJoin(deliveryJobs, eq(deliveryJobs.id, jobOffers.jobId))
      .innerJoin(jobStops, eq(jobStops.jobId, deliveryJobs.id))
      .where(
        and(
          eq(jobOffers.status, 'open'),
          eq(deliveryJobs.status, 'offered'),
          eq(deliveryJobs.special, false),
        ),
      )
      .groupBy(jobOffers.id, deliveryJobs.id)
      .orderBy(jobOffers.createdAt);
  }

  async activeJobs(tx: Transaction, driverId: string): Promise<ActiveJobRow[]> {
    const rows = await tx
      .select({ jobId: deliveryJobs.id, status: deliveryJobs.status, payout: deliveryJobs.payout })
      .from(deliveryJobs)
      .where(
        and(
          eq(deliveryJobs.driverId, driverId),
          inArray(deliveryJobs.status, ['assigned', 'picked_up']),
        ),
      )
      .orderBy(deliveryJobs.acceptedAt);
    return rows.flatMap((row) =>
      row.status === 'assigned' || row.status === 'picked_up'
        ? [{ ...row, status: row.status }]
        : [],
    );
  }

  async deliveredTotals(
    tx: Transaction,
    driverId: string,
  ): Promise<{ trips: number; payout: MoneyString }> {
    const [row] = await tx
      .select({ trips: count(), payout: sum(deliveryJobs.payout) })
      .from(deliveryJobs)
      .where(and(eq(deliveryJobs.driverId, driverId), eq(deliveryJobs.status, 'delivered')));
    return { trips: row?.trips ?? 0, payout: row?.payout ?? '0.00' };
  }
}
