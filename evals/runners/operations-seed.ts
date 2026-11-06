import type { OrderStatus } from '@buchi/shared';
import type { Database, Transaction } from '@buchi/server/db/client';
import {
  deliveryJobs,
  drivers,
  jobOffers,
  jobStops,
  orderEvents,
  orderItems,
  orders,
  products,
  productVariants,
} from '@buchi/server/db/schema';
import { withShop } from '@buchi/server/db/with-shop';
import { caseUuid } from '../harness/case-uuid';

/** The fixed clock of every case: 17:00 in Addis Ababa. */
export const NOW = new Date('2026-11-05T14:00:00Z');
const minutesBefore = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);
const customerPin = { deliveryLatitude: 9.0203, deliveryLongitude: 38.8027 };

export interface CaseIds {
  product: string;
  size42: string;
  size43: string;
  order: string;
  driver: string;
  job: string;
  offer: string;
}

export function idsOf(caseId: string): CaseIds {
  const id = (role: string) => caseUuid(`${caseId}:${role}`);
  return {
    product: id('product'),
    size42: id('size42'),
    size43: id('size43'),
    order: id('order'),
    driver: id('driver'),
    job: id('job'),
    offer: id('offer'),
  };
}

/** The statuses an order passes through on its way to `status`, each 10 minutes apart. */
const paths: Record<
  'awaiting_payment' | 'dispatching' | 'out_for_delivery' | 'delivered',
  OrderStatus[]
> = {
  awaiting_payment: ['awaiting_payment'],
  dispatching: ['awaiting_payment', 'verifying', 'paid', 'dispatching'],
  out_for_delivery: [
    'awaiting_payment',
    'verifying',
    'paid',
    'dispatching',
    'assigned',
    'out_for_delivery',
  ],
  delivered: [
    'awaiting_payment',
    'verifying',
    'paid',
    'dispatching',
    'assigned',
    'out_for_delivery',
    'delivered',
  ],
};

/** A fixed-price "Nike Air" in sizes 42 and 43. */
export async function seedProduct(
  db: Database,
  shopId: string,
  ids: CaseIds,
  stock: { size42: number; size43: number },
): Promise<void> {
  await withShop(db, shopId, async (tx) => {
    await tx.insert(products).values({
      id: ids.product,
      shopId,
      title: 'Nike Air',
      pricingMode: 'fixed',
      price: '3500.00',
      createdAt: minutesBefore(60 * 24 * 30),
    });
    await tx.insert(productVariants).values([
      { id: ids.size42, shopId, productId: ids.product, size: '42', stock: stock.size42 },
      { id: ids.size43, shopId, productId: ids.product, size: '43', stock: stock.size43 },
    ]);
  });
}

/** An Express order of one size-42 pair with its full timeline, ending in `status`. */
export async function seedOrder(
  db: Database,
  shopId: string,
  ids: CaseIds,
  order: {
    customerId: string;
    status: keyof typeof paths;
    paymentDeadline: Date;
  },
): Promise<void> {
  const path = paths[order.status];
  const startedAt = minutesBefore(10 * path.length + 10);
  await withShop(db, shopId, async (tx) => {
    await tx.insert(orders).values({
      id: ids.order,
      shopId,
      customerId: order.customerId,
      status: order.status,
      deliveryType: 'express',
      itemsTotal: '3500.00',
      deliveryFee: '125.00',
      total: '3625.00',
      ...customerPin,
      paymentDeadline: order.paymentDeadline,
      createdAt: startedAt,
    });
    await tx.insert(orderItems).values({
      shopId,
      orderId: ids.order,
      variantId: ids.size42,
      quantity: 1,
      unitPrice: '3500.00',
    });
    await insertTimeline(tx, shopId, ids.order, path, startedAt);
  });
}

async function insertTimeline(
  tx: Transaction,
  shopId: string,
  orderId: string,
  path: OrderStatus[],
  startedAt: Date,
): Promise<void> {
  await tx.insert(orderEvents).values(
    path.map((toStatus, index) => ({
      shopId,
      orderId,
      fromStatus: path[index - 1] ?? null,
      toStatus,
      actor: 'system' as const,
      reason: index === 0 ? 'Order created' : `Moved to ${toStatus}`,
      createdAt: new Date(startedAt.getTime() + index * 10 * 60_000),
    })),
  );
}

/**
 * The order's delivery job. `offered` has an open offer and no driver; the others have Abebe,
 * who picked the order up 50 minutes ago against an estimate of 15.
 */
export async function seedJob(
  db: Database,
  shopId: string,
  ids: CaseIds,
  status: 'offered' | 'picked_up' | 'delivered',
): Promise<void> {
  const pickedUpAt = minutesBefore(50);
  await withShop(db, shopId, async (tx) => {
    if (status !== 'offered') {
      await tx.insert(drivers).values({
        id: ids.driver,
        shopId,
        username: 'abebe_moto',
        telegramUserId: 2,
        name: 'Abebe',
        phone: '+251911000002',
        available: true,
        linkedAt: minutesBefore(60 * 24),
      });
    }
    await tx.insert(deliveryJobs).values({
      id: ids.job,
      shopId,
      status,
      driverId: status === 'offered' ? null : ids.driver,
      payout: '125.00',
      separateTripsPayout: '125.00',
      routeMeters: 5000,
      estimatedMinutes: 15,
      createdAt: minutesBefore(70),
      acceptedAt: status === 'offered' ? null : minutesBefore(60),
      pickedUpAt: status === 'offered' ? null : pickedUpAt,
      deliveredAt: status === 'delivered' ? minutesBefore(10) : null,
    });
    await tx.insert(jobStops).values({
      shopId,
      jobId: ids.job,
      orderId: ids.order,
      position: 1,
      deliveredAt: status === 'delivered' ? minutesBefore(10) : null,
      metersFromPin: status === 'delivered' ? 40 : null,
    });
    if (status === 'offered') {
      await tx.insert(jobOffers).values({
        id: ids.offer,
        shopId,
        jobId: ids.job,
        price: '125.00',
        createdAt: minutesBefore(10),
      });
    }
  });
}
