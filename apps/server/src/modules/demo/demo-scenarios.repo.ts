import { and, asc, eq, gt, isNotNull, sql } from 'drizzle-orm';
import type { Transaction } from '../../db/client';
import {
  customers,
  deliveryJobs,
  drivers,
  jobStops,
  orderEvents,
  orderItems,
  orders,
  products,
  productVariants,
  waitlist,
} from '../../db/schema';
import { zoneOf } from '../delivery/zones.domain';
import type { Coordinates } from '../delivery/location.domain';
import type { Money } from '@buchi/shared';

/** A trip on the road for one real customer and one real driver, as a scenario starts it. */
export interface RoadTrip {
  customerId: string;
  driverId: string;
  variantId: string;
  unitPrice: Money;
  deliveryFee: Money;
  pin: Coordinates;
  payout: Money;
  routeMeters: number;
  routingSeconds: number;
  estimatedMinutes: number;
  createdAt: Date;
  acceptedAt: Date;
  pickedUpAt: Date;
}

/** The rows that the demo scenarios read and start, in the shop the transaction is in. */
export class DemoScenariosRepo {
  /** The customer row of a real Telegram user, added the way their first message would add it. */
  async customerOf(
    tx: Transaction,
    shopId: string,
    telegramUserId: number,
  ): Promise<{ id: string; name: string }> {
    const [found] = await tx
      .select({ id: customers.id, name: customers.name })
      .from(customers)
      .where(eq(customers.telegramUserId, telegramUserId));
    if (found) return found;
    const [added] = await tx
      .insert(customers)
      .values({ shopId, telegramUserId, name: 'Demo customer' })
      .returning({ id: customers.id, name: customers.name });
    if (!added) throw new Error('Insert returned no customer');
    return added;
  }

  /** A linked driver of the shop with this Telegram user ID. */
  async linkedDriver(tx: Transaction, telegramUserId: number): Promise<string | undefined> {
    const [row] = await tx
      .select({ id: drivers.id })
      .from(drivers)
      .where(and(eq(drivers.telegramUserId, telegramUserId), isNotNull(drivers.linkedAt)));
    return row?.id;
  }

  /** A size of a demo product with a unit free to sell, and the product's shown price. */
  async freeDemoUnit(
    tx: Transaction,
  ): Promise<{ variantId: string; price: string; title: string } | undefined> {
    const [row] = await tx
      .select({ variantId: productVariants.id, price: products.price, title: products.title })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(
        and(
          eq(products.synthetic, true),
          eq(products.active, true),
          gt(productVariants.stock, productVariants.reserved),
        ),
      )
      .orderBy(asc(products.createdAt), asc(productVariants.size))
      .limit(1);
    return row;
  }

  /**
   * Inserts a paid order that a driver picked up, with its history, and takes its unit from stock
   * as payment would have. Returns the order and trip IDs.
   */
  async insertRoadTrip(
    tx: Transaction,
    shopId: string,
    trip: RoadTrip,
  ): Promise<{ orderId: string; jobId: string; stopId: string }> {
    const total = trip.unitPrice.add(trip.deliveryFee);
    const [order] = await tx
      .insert(orders)
      .values({
        shopId,
        customerId: trip.customerId,
        status: 'out_for_delivery',
        deliveryType: 'express',
        itemsTotal: trip.unitPrice.toString(),
        deliveryFee: trip.deliveryFee.toString(),
        total: total.toString(),
        deliveryLatitude: trip.pin.latitude,
        deliveryLongitude: trip.pin.longitude,
        deliveryZone: zoneOf(trip.pin),
        createdAt: trip.createdAt,
        updatedAt: trip.pickedUpAt,
      })
      .returning({ id: orders.id });
    if (!order) throw new Error('Insert returned no order');
    await tx.insert(orderItems).values({
      shopId,
      orderId: order.id,
      variantId: trip.variantId,
      quantity: 1,
      unitPrice: trip.unitPrice.toString(),
    });
    const steps = [
      ['awaiting_payment', 'customer', 'Order created', trip.createdAt],
      ['verifying', 'customer', 'Payment screenshot received', trip.createdAt],
      ['paid', 'system', 'Payment checked with the bank', trip.createdAt],
      ['dispatching', 'system', 'Offered to drivers', trip.acceptedAt],
      ['assigned', 'driver', 'Accepted', trip.acceptedAt],
      ['out_for_delivery', 'driver', 'Picked up', trip.pickedUpAt],
    ] as const;
    await tx.insert(orderEvents).values(
      steps.map(([toStatus, actor, reason, createdAt], index) => ({
        shopId,
        orderId: order.id,
        fromStatus: steps[index - 1]?.[0] ?? null,
        toStatus,
        actor,
        reason,
        createdAt,
      })),
    );
    await tx
      .update(productVariants)
      .set({ stock: sql`${productVariants.stock} - 1` })
      .where(eq(productVariants.id, trip.variantId));
    const [job] = await tx
      .insert(deliveryJobs)
      .values({
        shopId,
        driverId: trip.driverId,
        status: 'picked_up',
        payout: trip.payout.toString(),
        separateTripsPayout: trip.payout.toString(),
        routeMeters: trip.routeMeters,
        estimatedMinutes: trip.estimatedMinutes,
        createdAt: trip.acceptedAt,
        acceptedAt: trip.acceptedAt,
        pickedUpAt: trip.pickedUpAt,
      })
      .returning({ id: deliveryJobs.id });
    if (!job) throw new Error('Insert returned no trip');
    const [stop] = await tx
      .insert(jobStops)
      .values({
        shopId,
        jobId: job.id,
        orderId: order.id,
        position: 1,
        routingSeconds: trip.routingSeconds,
        expectedSeconds: trip.estimatedMinutes * 60,
      })
      .returning({ id: jobStops.id });
    if (!stop) throw new Error('Insert returned no stop');
    return { orderId: order.id, jobId: job.id, stopId: stop.id };
  }

  /** The sold-out demo size that demo customers wait for, and when the first of them joined. */
  async waitedSize(
    tx: Transaction,
  ): Promise<{ variantId: string; title: string; size: string; firstJoined: Date } | undefined> {
    const [row] = await tx
      .select({
        variantId: productVariants.id,
        title: products.title,
        size: productVariants.size,
        firstJoined: sql<Date>`min(${waitlist.joinedAt})`.mapWith(
          (value: string) => new Date(value),
        ),
      })
      .from(waitlist)
      .innerJoin(productVariants, eq(productVariants.id, waitlist.variantId))
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(and(eq(products.synthetic, true), eq(productVariants.stock, 0)))
      .groupBy(productVariants.id, products.title, productVariants.size)
      .limit(1);
    return row;
  }

  /** Puts the customer first in line, or moves them there if they already wait. */
  async waitFirst(
    tx: Transaction,
    shopId: string,
    variantId: string,
    customerId: string,
    joinedAt: Date,
  ): Promise<void> {
    await tx
      .insert(waitlist)
      .values({ shopId, variantId, customerId, joinedAt })
      .onConflictDoUpdate({
        target: [waitlist.variantId, waitlist.customerId],
        set: { joinedAt, notifiedAt: null },
      });
  }
}
