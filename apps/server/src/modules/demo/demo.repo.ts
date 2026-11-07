import { and, eq, gte, inArray, isNotNull, lt, or, sql } from 'drizzle-orm';
import type { Database, Transaction } from '../../db/client';
import {
  areaNotes,
  customers,
  deliveryJobs,
  drivers,
  farQuotes,
  jobStops,
  orderEvents,
  orderExchanges,
  orderItems,
  orders,
  paymentProofs,
  paymentRefs,
  products,
  timers,
  waitlist,
} from '../../db/schema';
import { DEMO_TELEGRAM_ID_BASE } from '../../shared/demo-ids';
import { zoneOf } from '../delivery/zones.domain';
import type { DemoCustomer, DemoOrder } from './demo-history.domain';

/** What a demo reset removed or retired, for the script to print. */
export interface ResetCounts {
  customers: number;
  orders: number;
  trips: number;
  drivers: number;
  farTrips: number;
  productsDeleted: number;
  productsRetired: number;
  areaNotes: number;
}

/** Demo rows: people with demo Telegram IDs, what hangs off them, and synthetic products. */
export class DemoRepo {
  async insertCustomers(tx: Transaction, shopId: string, people: DemoCustomer[]): Promise<void> {
    if (people.length === 0) return;
    await tx.insert(customers).values(people.map((person) => ({ ...person, shopId })));
  }

  async insertDrivers(
    tx: Transaction,
    shopId: string,
    people: { id: string; telegramUserId: number; name: string; username: string }[],
    linkedAt: Date,
  ): Promise<void> {
    if (people.length === 0) return;
    await tx.insert(drivers).values(
      people.map((person, index) => ({
        ...person,
        shopId,
        phone: `+2519110000${String(10 + index)}`,
        available: index % 2 === 0,
        linkedAt,
      })),
    );
  }

  /** The shop's real, linked drivers, who get a share of the demo trips. */
  async realDriverIds(tx: Transaction): Promise<string[]> {
    const rows = await tx
      .select({ id: drivers.id })
      .from(drivers)
      .where(
        and(isNotNull(drivers.telegramUserId), lt(drivers.telegramUserId, DEMO_TELEGRAM_ID_BASE)),
      );
    return rows.map((row) => row.id);
  }

  /** Each order with its item, its history, its payment, and its trip. */
  async insertOrders(tx: Transaction, shopId: string, planned: DemoOrder[]): Promise<void> {
    for (const order of planned) {
      const [created] = order.timeline;
      const last = order.timeline.at(-1) ?? created;
      const itemsTotal = order.unitPrice;
      await tx.insert(orders).values({
        id: order.id,
        shopId,
        customerId: order.customerId,
        status: last.status,
        deliveryType: order.deliveryType,
        itemsTotal: itemsTotal.toString(),
        deliveryFee: order.deliveryFee.toString(),
        total: itemsTotal.add(order.deliveryFee).toString(),
        deliveryLatitude: order.pin?.latitude ?? null,
        deliveryLongitude: order.pin?.longitude ?? null,
        deliveryZone: order.pin ? zoneOf(order.pin) : null,
        createdAt: created.at,
        updatedAt: last.at,
      });
      await tx.insert(orderItems).values({
        shopId,
        orderId: order.id,
        variantId: order.variantId,
        quantity: 1,
        unitPrice: order.unitPrice.toString(),
      });
      await tx.insert(orderEvents).values(
        order.timeline.map((step, index) => ({
          shopId,
          orderId: order.id,
          fromStatus: order.timeline[index - 1]?.status ?? null,
          toStatus: step.status,
          actor: step.actor,
          reason: step.reason,
          createdAt: step.at,
        })),
      );
      await this.insertPayment(tx, shopId, order);
      await this.insertTrip(tx, shopId, order);
    }
  }

  private async insertPayment(tx: Transaction, shopId: string, order: DemoOrder): Promise<void> {
    const { payment } = order;
    if (!payment) return;
    const amount = order.unitPrice.add(order.deliveryFee).toString();
    await tx.insert(paymentProofs).values({
      shopId,
      orderId: order.id,
      provider: payment.provider,
      txRef: payment.txRef,
      amount,
      decision: payment.decision,
      bankCheck: payment.bankCheck,
      reasons: payment.reasons,
      ownerDecision: payment.ownerDecision,
      reportedAt: payment.reportedAt,
      createdAt: payment.at,
    });
    if (payment.decision !== 'reject') {
      await tx
        .insert(paymentRefs)
        .values({ provider: payment.provider, txRef: payment.txRef, orderId: order.id });
    }
  }

  private async insertTrip(tx: Transaction, shopId: string, order: DemoOrder): Promise<void> {
    const { trip } = order;
    if (!trip) return;
    await tx.insert(deliveryJobs).values({
      id: trip.id,
      shopId,
      driverId: trip.driverId,
      status: 'delivered',
      payout: trip.payout.toString(),
      separateTripsPayout: trip.payout.toString(),
      routeMeters: trip.routeMeters,
      estimatedMinutes: trip.estimatedMinutes,
      actualMinutes: trip.actualMinutes,
      createdAt: trip.acceptedAt,
      acceptedAt: trip.acceptedAt,
      pickedUpAt: trip.pickedUpAt,
      deliveredAt: trip.deliveredAt,
    });
    await tx.insert(jobStops).values({
      shopId,
      jobId: trip.id,
      orderId: order.id,
      position: 1,
      routingSeconds: trip.routingSeconds,
      expectedSeconds: trip.expectedSeconds,
      deliveredAt: trip.deliveredAt,
      metersFromPin: trip.metersFromPin,
      receipt: trip.receipt,
      receiptAt: trip.deliveredAt,
    });
  }

  async markSynthetic(tx: Transaction, productId: string): Promise<void> {
    await tx.update(products).set({ synthetic: true }).where(eq(products.id, productId));
  }

  async joinWaitlist(
    tx: Transaction,
    shopId: string,
    variantId: string,
    entries: { customerId: string; joinedAt: Date }[],
  ): Promise<void> {
    if (entries.length === 0) return;
    await tx
      .insert(waitlist)
      .values(entries.map((entry) => ({ ...entry, shopId, variantId })))
      .onConflictDoNothing();
  }

  /**
   * Removes the demo rows of the shop the transaction is in, children first, and returns the IDs
   * of the removed orders, trips, and products for their timers. A synthetic product that a real order still
   * names stays, retired, so that order keeps its item.
   */
  async deleteShopRows(
    tx: Transaction,
    demoNotes: string[],
  ): Promise<{ counts: ResetCounts; removedIds: string[] }> {
    const customerIds = (
      await tx
        .select({ id: customers.id })
        .from(customers)
        .where(gte(customers.telegramUserId, DEMO_TELEGRAM_ID_BASE))
    ).map((row) => row.id);
    const driverIds = (
      await tx
        .select({ id: drivers.id })
        .from(drivers)
        .where(gte(drivers.telegramUserId, DEMO_TELEGRAM_ID_BASE))
    ).map((row) => row.id);
    const orderIds =
      customerIds.length === 0
        ? []
        : (
            await tx
              .select({ id: orders.id })
              .from(orders)
              .where(inArray(orders.customerId, customerIds))
          ).map((row) => row.id);
    const jobConditions = [
      ...(orderIds.length > 0 ? [inArray(jobStops.orderId, orderIds)] : []),
      ...(driverIds.length > 0 ? [inArray(deliveryJobs.driverId, driverIds)] : []),
    ];
    const jobIds =
      jobConditions.length === 0
        ? []
        : [
            ...new Set(
              (
                await tx
                  .select({ id: deliveryJobs.id })
                  .from(deliveryJobs)
                  .leftJoin(jobStops, eq(jobStops.jobId, deliveryJobs.id))
                  .where(or(...jobConditions))
              ).map((row) => row.id),
            ),
          ];
    if (jobIds.length > 0) await tx.delete(deliveryJobs).where(inArray(deliveryJobs.id, jobIds));
    if (orderIds.length > 0) await tx.delete(orders).where(inArray(orders.id, orderIds));
    if (customerIds.length > 0)
      await tx.delete(customers).where(inArray(customers.id, customerIds));
    if (driverIds.length > 0) await tx.delete(drivers).where(inArray(drivers.id, driverIds));
    const farTrips = await tx
      .delete(farQuotes)
      .where(eq(farQuotes.synthetic, true))
      .returning({ id: farQuotes.id });
    const notes =
      demoNotes.length === 0
        ? []
        : await tx
            .delete(areaNotes)
            .where(inArray(areaNotes.note, demoNotes))
            .returning({ id: areaNotes.id });
    const { deletedIds, retired } = await this.removeSyntheticProducts(tx);
    const counts = {
      customers: customerIds.length,
      orders: orderIds.length,
      trips: jobIds.length,
      drivers: driverIds.length,
      farTrips: farTrips.length,
      areaNotes: notes.length,
      productsDeleted: deletedIds.length,
      productsRetired: retired,
    };
    return { counts, removedIds: [...orderIds, ...jobIds, ...deletedIds] };
  }

  private async removeSyntheticProducts(
    tx: Transaction,
  ): Promise<{ deletedIds: string[]; retired: number }> {
    const ordered = sql`exists (
      select 1 from ${orderItems}
      join product_variants v on v.id = ${orderItems.variantId}
      where v.product_id = ${products.id}
    ) or exists (
      select 1 from ${orderExchanges}
      join product_variants v on v.id in (${orderExchanges.fromVariantId}, ${orderExchanges.toVariantId})
      where v.product_id = ${products.id}
    )`;
    const retired = await tx
      .update(products)
      .set({ active: false })
      .where(and(eq(products.synthetic, true), eq(products.active, true), ordered))
      .returning({ id: products.id });
    const deleted = await tx
      .delete(products)
      .where(and(eq(products.synthetic, true), sql`not (${ordered})`))
      .returning({ id: products.id });
    return { deletedIds: deleted.map((row) => row.id), retired: retired.length };
  }

  /** Timers of removed rows. Timers have no row-level security, so this runs outside any shop. */
  async deleteTimers(db: Database, targetIds: string[]): Promise<void> {
    if (targetIds.length > 0) await db.delete(timers).where(inArray(timers.targetId, targetIds));
  }
}
