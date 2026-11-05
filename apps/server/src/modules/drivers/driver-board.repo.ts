import type { MoneyString } from '@buchi/shared';
import { and, count, eq, inArray, sum, type SQL } from 'drizzle-orm';
import type { Transaction } from '../../db/client';
import { deliveryJobs, jobOffers, jobStops } from '../../db/schema';

export interface OpenOfferRow {
  offerId: string;
  price: MoneyString;
  raiseStep: number;
  far: boolean;
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
  /** Open offers, far-area ones included: the driver holds those instead of accepting them. */
  openOffers(tx: Transaction): Promise<OpenOfferRow[]> {
    return this.offers(tx, and(eq(jobOffers.status, 'open'), eq(deliveryJobs.status, 'offered')));
  }

  /** Far-area offers that the driver holds while the customer decides and pays. */
  heldOffers(tx: Transaction, driverId: string): Promise<OpenOfferRow[]> {
    return this.offers(
      tx,
      and(eq(jobOffers.status, 'held'), eq(jobOffers.takenByDriverId, driverId)),
    );
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

  private offers(tx: Transaction, where: SQL | undefined): Promise<OpenOfferRow[]> {
    return tx
      .select({
        offerId: jobOffers.id,
        price: jobOffers.price,
        raiseStep: jobOffers.raiseStep,
        far: deliveryJobs.special,
        routeMeters: deliveryJobs.routeMeters,
        estimatedMinutes: deliveryJobs.estimatedMinutes,
        stops: count(jobStops.id),
      })
      .from(jobOffers)
      .innerJoin(deliveryJobs, eq(deliveryJobs.id, jobOffers.jobId))
      .innerJoin(jobStops, eq(jobStops.jobId, deliveryJobs.id))
      .where(where)
      .groupBy(jobOffers.id, deliveryJobs.id)
      .orderBy(jobOffers.createdAt);
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
