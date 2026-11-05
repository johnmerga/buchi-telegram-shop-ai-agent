import type { MoneyString } from '@buchi/shared';
import { and, asc, count, desc, eq, inArray, isNotNull, isNull, max, ne } from 'drizzle-orm';
import type { Transaction } from '../../db/client';
import { deliveryJobs, jobOffers, jobStops, offerMessages } from '../../db/schema';
import type { MessageRef } from '../owner/owner-notifier.service';

export type JobRow = typeof deliveryJobs.$inferSelect;
export type StopRow = typeof jobStops.$inferSelect;
export type OfferRow = typeof jobOffers.$inferSelect;
export type Receipt = NonNullable<StopRow['receipt']>;

/** An order on a job, with the routing time of the leg that ends at it. */
export interface NewStop {
  orderId: string;
  routingSeconds: number;
  expectedSeconds: number;
}

export interface NewJob {
  shopId: string;
  special: boolean;
  payout: MoneyString;
  separateTripsPayout: MoneyString;
  routeMeters: number;
  estimatedMinutes: number;
  /** In the order the driver visits them. */
  stops: NewStop[];
}

export class DeliveryJobsRepo {
  async insertJob(tx: Transaction, job: NewJob): Promise<JobRow> {
    const { stops, ...values } = job;
    const [row] = await tx.insert(deliveryJobs).values(values).returning();
    if (!row) throw new Error('Insert returned no delivery job');
    await tx.insert(jobStops).values(
      stops.map((stop, index) => ({
        ...stop,
        shopId: job.shopId,
        jobId: row.id,
        position: index + 1,
      })),
    );
    return row;
  }

  async insertOffer(
    tx: Transaction,
    offer: { shopId: string; jobId: string; price: MoneyString; raiseStep: number },
  ): Promise<OfferRow> {
    const [row] = await tx.insert(jobOffers).values(offer).returning();
    if (!row) throw new Error('Insert returned no job offer');
    return row;
  }

  async findJob(tx: Transaction, jobId: string): Promise<JobRow | undefined> {
    const [row] = await tx.select().from(deliveryJobs).where(eq(deliveryJobs.id, jobId));
    return row;
  }

  stops(tx: Transaction, jobId: string): Promise<StopRow[]> {
    return tx
      .select()
      .from(jobStops)
      .where(eq(jobStops.jobId, jobId))
      .orderBy(asc(jobStops.position));
  }

  async findOffer(tx: Transaction, offerId: string): Promise<OfferRow | undefined> {
    const [row] = await tx.select().from(jobOffers).where(eq(jobOffers.id, offerId));
    return row;
  }

  async recordOfferMessages(
    tx: Transaction,
    shopId: string,
    offerId: string,
    messages: MessageRef[],
  ): Promise<void> {
    if (messages.length === 0) return;
    await tx
      .insert(offerMessages)
      .values(messages.map(({ chatId, messageId }) => ({ shopId, offerId, chatId, messageId })));
  }

  offerMessages(tx: Transaction, offerId: string): Promise<MessageRef[]> {
    return tx
      .select({ chatId: offerMessages.chatId, messageId: offerMessages.messageId })
      .from(offerMessages)
      .where(eq(offerMessages.offerId, offerId));
  }

  /**
   * First accept wins: the offer moves from open to taken in one conditional statement. A parallel
   * accept waits for the row lock, then finds the offer no longer open and gets nothing. A special
   * offer is only ever held, because its customer has not paid yet.
   */
  takeOffer(tx: Transaction, offerId: string, driverId: string): Promise<OfferRow | undefined> {
    return this.claimOffer(tx, offerId, driverId, { to: 'taken', special: false });
  }

  /** First accept wins for a special offer too, but the driver only holds it until payment. */
  holdOffer(tx: Transaction, offerId: string, driverId: string): Promise<OfferRow | undefined> {
    return this.claimOffer(tx, offerId, driverId, { to: 'held', special: true });
  }

  /** The held offer on the special job of an order, which its holder takes once the order is paid. */
  async heldOfferOf(tx: Transaction, orderId: string): Promise<OfferRow | undefined> {
    const [row] = await tx
      .select({ offer: jobOffers })
      .from(jobOffers)
      .innerJoin(jobStops, eq(jobStops.jobId, jobOffers.jobId))
      .where(and(eq(jobStops.orderId, orderId), eq(jobOffers.status, 'held')));
    return row?.offer;
  }

  async takeHeldOffer(tx: Transaction, offerId: string): Promise<OfferRow | undefined> {
    const [row] = await tx
      .update(jobOffers)
      .set({ status: 'taken' })
      .where(and(eq(jobOffers.id, offerId), eq(jobOffers.status, 'held')))
      .returning();
    return row;
  }

  /** The special job of an order that no driver has taken yet. */
  async untakenSpecialJobOf(tx: Transaction, orderId: string): Promise<JobRow | undefined> {
    const [row] = await tx
      .select({ job: deliveryJobs })
      .from(deliveryJobs)
      .innerJoin(jobStops, eq(jobStops.jobId, deliveryJobs.id))
      .where(
        and(
          eq(jobStops.orderId, orderId),
          eq(deliveryJobs.special, true),
          eq(deliveryJobs.status, 'offered'),
        ),
      );
    return row?.job;
  }

  /** Every offer message of a job, from every raise step. */
  jobOfferMessages(tx: Transaction, jobId: string): Promise<MessageRef[]> {
    return tx
      .select({ chatId: offerMessages.chatId, messageId: offerMessages.messageId })
      .from(offerMessages)
      .innerJoin(jobOffers, eq(jobOffers.id, offerMessages.offerId))
      .where(eq(jobOffers.jobId, jobId));
  }

  /** Deletes a job with its stops and offers, which frees its orders for another job. */
  async deleteJob(tx: Transaction, jobId: string): Promise<void> {
    await tx.delete(deliveryJobs).where(eq(deliveryJobs.id, jobId));
  }

  async expireOffer(tx: Transaction, offerId: string): Promise<OfferRow | undefined> {
    const [row] = await tx
      .update(jobOffers)
      .set({ status: 'expired' })
      .where(and(eq(jobOffers.id, offerId), eq(jobOffers.status, 'open')))
      .returning();
    return row;
  }

  /** The accepted offer's price becomes the payout, so an owner bonus reaches the driver. */
  async assign(
    tx: Transaction,
    jobId: string,
    assignment: { driverId: string; payout: MoneyString; acceptedAt: Date },
  ): Promise<JobRow | undefined> {
    const [row] = await tx
      .update(deliveryJobs)
      .set({ status: 'assigned', ...assignment })
      .where(and(eq(deliveryJobs.id, jobId), eq(deliveryJobs.status, 'offered')))
      .returning();
    return row;
  }

  async pickUp(
    tx: Transaction,
    jobId: string,
    driverId: string,
    pickedUpAt: Date,
  ): Promise<JobRow | undefined> {
    const [row] = await tx
      .update(deliveryJobs)
      .set({ status: 'picked_up', pickedUpAt })
      .where(
        and(
          eq(deliveryJobs.id, jobId),
          eq(deliveryJobs.driverId, driverId),
          eq(deliveryJobs.status, 'assigned'),
        ),
      )
      .returning();
    return row;
  }

  /** Marks the stop as waiting for the driver's location, if it is theirs and still on the way. */
  async requestLocation(
    tx: Transaction,
    stopId: string,
    driverId: string,
    requestedAt: Date,
  ): Promise<boolean> {
    const updated = await tx
      .update(jobStops)
      .set({ locationRequestedAt: requestedAt })
      .where(
        and(
          eq(jobStops.id, stopId),
          isNull(jobStops.deliveredAt),
          inArray(jobStops.jobId, this.jobsOnTheWay(tx, driverId)),
        ),
      )
      .returning({ id: jobStops.id });
    return updated.length > 0;
  }

  /** The stop the driver most recently tapped **Delivered** for, still waiting for a location. */
  async awaitingLocation(tx: Transaction, driverId: string): Promise<StopRow | undefined> {
    const [row] = await tx
      .select()
      .from(jobStops)
      .where(
        and(
          isNotNull(jobStops.locationRequestedAt),
          isNull(jobStops.deliveredAt),
          inArray(jobStops.jobId, this.jobsOnTheWay(tx, driverId)),
        ),
      )
      .orderBy(desc(jobStops.locationRequestedAt))
      .limit(1);
    return row;
  }

  /** A driver's stop that is still on the way, for a delivery confirmed without the chat. */
  async stopOnTheWay(
    tx: Transaction,
    stopId: string,
    driverId: string,
  ): Promise<StopRow | undefined> {
    const [row] = await tx
      .select()
      .from(jobStops)
      .where(
        and(
          eq(jobStops.id, stopId),
          isNull(jobStops.deliveredAt),
          inArray(jobStops.jobId, this.jobsOnTheWay(tx, driverId)),
        ),
      );
    return row;
  }

  async deliver(
    tx: Transaction,
    stopId: string,
    delivery: { deliveredAt: Date; metersFromPin: number; needsReview: boolean },
  ): Promise<StopRow | undefined> {
    const [row] = await tx
      .update(jobStops)
      .set(delivery)
      .where(and(eq(jobStops.id, stopId), isNull(jobStops.deliveredAt)))
      .returning();
    return row;
  }

  async undeliveredStops(tx: Transaction, jobId: string): Promise<number> {
    const [row] = await tx
      .select({ count: count() })
      .from(jobStops)
      .where(and(eq(jobStops.jobId, jobId), isNull(jobStops.deliveredAt)));
    return row?.count ?? 0;
  }

  async finish(
    tx: Transaction,
    jobId: string,
    finished: { deliveredAt: Date; actualMinutes: number },
  ): Promise<void> {
    await tx
      .update(deliveryJobs)
      .set({ status: 'delivered', ...finished })
      .where(and(eq(deliveryJobs.id, jobId), eq(deliveryJobs.status, 'picked_up')));
  }

  /** Records only the first answer, so a late tap cannot overwrite a problem report. */
  async setReceipt(
    tx: Transaction,
    orderId: string,
    receipt: Receipt,
    receiptAt: Date,
  ): Promise<boolean> {
    const updated = await tx
      .update(jobStops)
      .set({ receipt, receiptAt })
      .where(
        and(
          eq(jobStops.orderId, orderId),
          isNotNull(jobStops.deliveredAt),
          isNull(jobStops.receipt),
        ),
      )
      .returning({ id: jobStops.id });
    return updated.length > 0;
  }

  /**
   * When the leg to a stop began: when the driver delivered the job's previous stop, or picked up
   * the parcels for the first one.
   */
  async legStart(tx: Transaction, stop: StopRow): Promise<Date | undefined> {
    const [previous] = await tx
      .select({ at: max(jobStops.deliveredAt) })
      .from(jobStops)
      .where(and(eq(jobStops.jobId, stop.jobId), ne(jobStops.id, stop.id)));
    if (previous?.at) return previous.at;
    return (await this.findJob(tx, stop.jobId))?.pickedUpAt ?? undefined;
  }

  private async claimOffer(
    tx: Transaction,
    offerId: string,
    driverId: string,
    claim: { to: 'taken' | 'held'; special: boolean },
  ): Promise<OfferRow | undefined> {
    const jobsOfKind = tx
      .select({ id: deliveryJobs.id })
      .from(deliveryJobs)
      .where(eq(deliveryJobs.special, claim.special));
    const [row] = await tx
      .update(jobOffers)
      .set({ status: claim.to, takenByDriverId: driverId })
      .where(
        and(
          eq(jobOffers.id, offerId),
          eq(jobOffers.status, 'open'),
          inArray(jobOffers.jobId, jobsOfKind),
        ),
      )
      .returning();
    return row;
  }

  private jobsOnTheWay(tx: Transaction, driverId: string) {
    return tx
      .select({ id: deliveryJobs.id })
      .from(deliveryJobs)
      .where(and(eq(deliveryJobs.driverId, driverId), eq(deliveryJobs.status, 'picked_up')));
  }
}
