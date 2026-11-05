import type { MoneyString } from '@buchi/shared';
import { asc, eq, inArray, sql } from 'drizzle-orm';
import type { Transaction } from '../../db/client';
import { deliveryJobs, drivers, jobStops, orders } from '../../db/schema';

const openStatuses = ['offered', 'assigned', 'picked_up'] as const;
type OpenStatus = (typeof openStatuses)[number];

function isOpen(status: string): status is OpenStatus {
  return openStatuses.some((open) => open === status);
}

export interface OpenJobRow {
  jobId: string;
  status: OpenStatus;
  far: boolean;
  payout: MoneyString;
  driverName: string | null;
}

export interface MapStopRow {
  jobId: string;
  orderId: string;
  position: number;
  latitude: number | null;
  longitude: number | null;
  delivered: boolean;
}

/** Read-only queries for the owner's deliveries map. Every query runs inside `withShop`. */
export class DeliveryMapRepo {
  async openJobs(tx: Transaction): Promise<OpenJobRow[]> {
    const rows = await tx
      .select({
        jobId: deliveryJobs.id,
        status: deliveryJobs.status,
        far: deliveryJobs.special,
        payout: deliveryJobs.payout,
        driverName: drivers.name,
        driverUsername: drivers.username,
      })
      .from(deliveryJobs)
      .leftJoin(drivers, eq(drivers.id, deliveryJobs.driverId))
      .where(inArray(deliveryJobs.status, [...openStatuses]))
      .orderBy(asc(deliveryJobs.createdAt));
    return rows.flatMap(({ status, driverName, driverUsername, ...row }) =>
      isOpen(status) ? [{ ...row, status, driverName: driverName ?? driverUsername }] : [],
    );
  }

  stops(tx: Transaction, jobIds: string[]): Promise<MapStopRow[]> {
    if (jobIds.length === 0) return Promise.resolve([]);
    return tx
      .select({
        jobId: jobStops.jobId,
        orderId: jobStops.orderId,
        position: jobStops.position,
        latitude: orders.deliveryLatitude,
        longitude: orders.deliveryLongitude,
        delivered: sql<boolean>`${jobStops.deliveredAt} is not null`,
      })
      .from(jobStops)
      .innerJoin(orders, eq(orders.id, jobStops.orderId))
      .where(inArray(jobStops.jobId, jobIds))
      .orderBy(asc(jobStops.position));
  }
}
