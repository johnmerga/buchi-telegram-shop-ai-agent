import { Money, type DeliverySettings } from '@buchi/shared';
import type { Database, Transaction } from '../../db/client';
import { withShop } from '../../db/with-shop';
import type { DeliveryService } from '../delivery/delivery.service';
import { straightLineRoute } from '../delivery/distance.domain';
import { quoteDelivery } from '../delivery/fees.domain';
import type { Coordinates } from '../delivery/location.domain';
import { LATE_GRACE_MINUTES, lateAt } from '../drivers/dispatch.domain';
import { DELIVERY_LATE_TIMER } from '../drivers/trips.service';
import { orderReference } from '../orders/orders.domain';
import type { ShopsService } from '../shops/shops.service';
import { overCapSpot, roadTimes, scenarioPin } from './demo-scenarios.domain';
import type { DemoScenariosRepo } from './demo-scenarios.repo';

interface TimerScheduler {
  schedule(
    tx: Transaction,
    kind: string,
    targetId: string,
    shopId: string | null,
    dueAt: Date,
  ): Promise<unknown>;
}

export interface RoadScenario {
  order: string;
  product: string;
  lateCheckAt: Date;
}

/**
 * Starts the demo scenarios in a shop. Each one only sets up rows that the real flow would have
 * made, and the real timers, events, and agents take it from there.
 */
export class DemoScenarios {
  constructor(
    private readonly db: Database,
    private readonly repo: DemoScenariosRepo,
    private readonly shops: Pick<ShopsService, 'get'>,
    private readonly delivery: Pick<DeliveryService, 'saveSettings' | 'savedSettings'>,
    private readonly timers: TimerScheduler,
    private readonly now: () => Date,
  ) {}

  /**
   * A paid order on its way to the customer with the driver. A late trip's check is due now, so
   * the next tick wakes the operations agent; otherwise the driver can report a problem, such as
   * a customer who does not answer.
   */
  async onTheRoad(
    shopId: string,
    people: { customer: number; driver: number },
    late: boolean,
  ): Promise<RoadScenario> {
    const { origin, settings } = await this.deliveryOf(shopId);
    return withShop(this.db, shopId, async (tx) => {
      const customerId = await this.repo.customerOf(tx, shopId, people.customer);
      const driverId = await this.repo.linkedDriver(tx, people.driver);
      if (!driverId)
        throw new Error(`Telegram user ${String(people.driver)} is not a linked driver`);
      const unit = await this.repo.freeDemoUnit(tx);
      if (!unit) throw new Error('No demo product has a free unit; run demo:seed first');
      const pin = scenarioPin(origin);
      const route = straightLineRoute(origin, pin);
      const option = quoteDelivery(route, 1, settings).options[0];
      if (!option) throw new Error('The scenario pin has no delivery option');
      const estimatedMinutes = Math.max(5, Math.round(route.seconds / 60));
      const times = roadTimes(this.now(), estimatedMinutes, late, LATE_GRACE_MINUTES);
      const { orderId, jobId } = await this.repo.insertRoadTrip(tx, shopId, {
        customerId,
        driverId,
        variantId: unit.variantId,
        unitPrice: Money.of(unit.price),
        deliveryFee: option.fee,
        pin,
        payout: option.payout,
        routeMeters: route.meters,
        routingSeconds: route.seconds,
        estimatedMinutes,
        ...times,
      });
      const lateCheckAt = late ? this.now() : lateAt(times.pickedUpAt, estimatedMinutes);
      await this.timers.schedule(tx, DELIVERY_LATE_TIMER, jobId, shopId, lateCheckAt);
      return { order: orderReference(orderId), product: unit.title, lateCheckAt };
    });
  }

  /**
   * Puts a real customer first in line for the sold-out demo size. The owner's restock in the
   * dashboard then holds a unit for them and tells them in the chat.
   */
  restockWaitlist(shopId: string, customer: number): Promise<{ product: string; size: string }> {
    return withShop(this.db, shopId, async (tx) => {
      const size = await this.repo.waitedSize(tx);
      if (!size) throw new Error('No sold-out demo size has a waitlist; run demo:seed first');
      const customerId = await this.repo.customerOf(tx, shopId, customer);
      const first = new Date(size.firstJoined.getTime() - 60_000);
      await this.repo.waitFirst(tx, shopId, size.variantId, customerId, first);
      return { product: size.title, size: size.size };
    });
  }

  /** A spot whose far price is above the cap. It changes nothing; the customer shares the spot. */
  async farOverCap(
    shopId: string,
  ): Promise<NonNullable<ReturnType<typeof overCapSpot>> & { cap: string }> {
    const { origin, settings } = await this.deliveryOf(shopId);
    const spot = overCapSpot(origin, settings);
    if (!spot) throw new Error('The far range ends before a price passes the cap');
    return { ...spot, cap: settings.farCap };
  }

  private async deliveryOf(
    shopId: string,
  ): Promise<{ origin: Coordinates; settings: DeliverySettings }> {
    const shop = await this.shops.get(shopId);
    const { settings } = await this.delivery.savedSettings(shopId);
    if (shop.latitude === null || shop.longitude === null || !settings) {
      throw new Error('Set the shop location and delivery settings first');
    }
    return { origin: { latitude: shop.latitude, longitude: shop.longitude }, settings };
  }
}
