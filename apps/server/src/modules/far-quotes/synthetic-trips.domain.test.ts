import { Money } from '@buchi/shared';
import { describe, expect, it } from 'vitest';
import { syntheticTrips } from './synthetic-trips.domain';

const input = {
  origin: { latitude: 9.0108, longitude: 38.7613 },
  settings: {
    baseFee: '40',
    ratePerKm: '12.50',
    ratePerMinute: '1.50',
    freeRadiusKm: 2.5,
    standardRangeKm: 8,
    farRangeKm: 20,
    farCap: '1000',
    saverDiscountPercent: 15,
  },
  now: new Date('2026-11-05T09:00:00Z'),
  count: 50,
  seed: 7,
};

describe('syntheticTrips', () => {
  const trips = syntheticTrips(input);

  it('repeats exactly for the same seed, and differs for another', () => {
    expect(syntheticTrips(input)).toEqual(trips);
    expect(syntheticTrips({ ...input, seed: 8 })[0]?.far.id).not.toBe(trips[0]?.far.id);
  });

  it('spreads far trips over the last 120 days, oldest first', () => {
    const times = trips.map((trip) => trip.leg.startedAt.getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(Math.min(...times)).toBeGreaterThan(input.now.getTime() - 121 * 24 * 60 * 60_000);
    expect(Math.max(...times)).toBeLessThan(input.now.getTime() + 24 * 60 * 60_000);
  });

  it('keeps every trip in the far range with prices drivers held above the formula payout', () => {
    for (const { far, leg } of trips) {
      expect(far.routeMeters).toBeGreaterThanOrEqual(8000);
      expect(far.routeMeters).toBeLessThanOrEqual(20_000);
      expect(leg.routingSeconds).toBe(far.routingSeconds);
      expect(Money.of(far.heldPrice).compare(Money.of(far.formulaPayout))).toBe(1);
      expect(Money.of(far.firstPrice).compare(Money.of(far.heldPrice))).toBeLessThanOrEqual(0);
      expect(far.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
    }
  });

  it('makes trips to the south slower than trips to the north, as its made-up truth says', () => {
    const ratio = (south: boolean) => {
      const legs = trips.filter((t) => t.destination.latitude < input.origin.latitude === south);
      return (
        legs.reduce((sum, t) => sum + t.leg.actualSeconds / t.leg.routingSeconds, 0) / legs.length
      );
    };
    expect(ratio(true)).toBeGreaterThan(ratio(false));
  });
});
