import { and, eq, inArray } from 'drizzle-orm';
import type { Transaction } from '../../db/client';
import { deliveryJobs, jobOffers, jobStops, offerMessages } from '../../db/schema';
import type { MessageRef } from '../owner/owner-notifier.service';
import type { JobRow, OfferRow } from './delivery-jobs.repo';

/** The queries only far-area jobs need: holding an offer, taking it at payment, withdrawing it. */
export class SpecialJobsRepo {
  /** First accept wins, as for any offer, but the driver only holds the job until payment. */
  async holdOffer(
    tx: Transaction,
    offerId: string,
    driverId: string,
  ): Promise<OfferRow | undefined> {
    const specialJobs = tx
      .select({ id: deliveryJobs.id })
      .from(deliveryJobs)
      .where(eq(deliveryJobs.special, true));
    const [row] = await tx
      .update(jobOffers)
      .set({ status: 'held', takenByDriverId: driverId })
      .where(
        and(
          eq(jobOffers.id, offerId),
          eq(jobOffers.status, 'open'),
          inArray(jobOffers.jobId, specialJobs),
        ),
      )
      .returning();
    return row;
  }

  /** Takes the held offer on an order's special job, for its holder once the order is paid. */
  async takeHeldOffer(tx: Transaction, orderId: string): Promise<OfferRow | undefined> {
    const heldForOrder = tx
      .select({ id: jobOffers.id })
      .from(jobOffers)
      .innerJoin(jobStops, eq(jobStops.jobId, jobOffers.jobId))
      .where(and(eq(jobStops.orderId, orderId), eq(jobOffers.status, 'held')));
    const [row] = await tx
      .update(jobOffers)
      .set({ status: 'taken' })
      .where(and(inArray(jobOffers.id, heldForOrder), eq(jobOffers.status, 'held')))
      .returning();
    return row;
  }

  /** The special job of an order that no driver has taken yet. */
  async untakenJobOf(tx: Transaction, orderId: string): Promise<JobRow | undefined> {
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
  offerMessages(tx: Transaction, jobId: string): Promise<MessageRef[]> {
    return tx
      .select({ chatId: offerMessages.chatId, messageId: offerMessages.messageId })
      .from(offerMessages)
      .innerJoin(jobOffers, eq(jobOffers.id, offerMessages.offerId))
      .where(eq(jobOffers.jobId, jobId));
  }

  /** Deletes a job with its stops and offers, which frees its order for another job. */
  async deleteJob(tx: Transaction, jobId: string): Promise<void> {
    await tx.delete(deliveryJobs).where(eq(deliveryJobs.id, jobId));
  }
}
