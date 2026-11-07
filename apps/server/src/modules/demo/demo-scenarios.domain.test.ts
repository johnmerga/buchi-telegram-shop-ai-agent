import { Money } from '@buchi/shared';
import { describe, expect, it } from 'vitest';
import { straightLineRoute } from '../delivery/distance.domain';
import { deliveryArea, driverPayout } from '../delivery/fees.domain';
import { LATE_GRACE_MINUTES, lateAt } from '../drivers/dispatch.domain';
import { DEMO_DELIVERY_SETTINGS } from './demo-shop.domain';
import { overCapSpot, roadTimes } from './demo-scenarios.domain';

const now = new Date('2026-11-07T09:00:00Z');
const shop = { latitude: 9.0, longitude: 38.76 };

describe('roadTimes', () => {
  it('makes a late trip due for its late check now, and keeps any other ahead', () => {
    const late = roadTimes(now, 20, true, LATE_GRACE_MINUTES);
    expect(lateAt(late.pickedUpAt, 20).getTime()).toBeLessThanOrEqual(now.getTime());
    const onTime = roadTimes(now, 20, false, LATE_GRACE_MINUTES);
    expect(lateAt(onTime.pickedUpAt, 20).getTime()).toBeGreaterThan(now.getTime());
    expect(onTime.createdAt < onTime.acceptedAt && onTime.acceptedAt < onTime.pickedUpAt).toBe(
      true,
    );
  });
});

describe('overCapSpot', () => {
  it('finds a far spot whose formula payout clears the cap by a quarter', () => {
    const spot = overCapSpot(shop, DEMO_DELIVERY_SETTINGS);
    if (!spot) throw new Error('No spot');
    const route = straightLineRoute(shop, spot.point);
    expect(deliveryArea(route.meters, DEMO_DELIVERY_SETTINGS)).toBe('far');
    const payout = driverPayout(route, 1, DEMO_DELIVERY_SETTINGS);
    expect(payout.compare(Money.of('500.00'))).toBeGreaterThan(0);
  });

  it('finds none when the far range ends first', () => {
    expect(overCapSpot(shop, { ...DEMO_DELIVERY_SETTINGS, farCap: '5000.00' })).toBeUndefined();
  });
});
