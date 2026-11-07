import { Money } from '@buchi/shared';
import { describe, expect, it } from 'vitest';
import { parentZone, zoneOf } from '../delivery/zones.domain';
import {
  acceptanceFactorZones,
  acceptedMultiple,
  assertOfferable,
  raisedPrice,
  scaled,
  similarTrips,
  statisticalPrice,
  type PastTrip,
} from './far-quotes.domain';

describe('acceptanceFactorZones', () => {
  it("looks for an acceptance factor in the trip's larger zone, then the whole shop", () => {
    const zone = zoneOf({ latitude: 8.9, longitude: 38.77 });
    expect(acceptanceFactorZones(zone)).toEqual([parentZone(zone), 'shop']);
  });
});

describe('acceptedMultiple', () => {
  it("is the accepted price over the trip's own formula payout", () => {
    expect(acceptedMultiple({ formulaPayout: Money.of('200'), heldPrice: Money.of('260') })).toBe(
      1.3,
    );
  });

  it('is null when that formula paid nothing', () => {
    expect(
      acceptedMultiple({ formulaPayout: Money.of('0'), heldPrice: Money.of('50') }),
    ).toBeNull();
  });
});

describe('scaled', () => {
  it('multiplies by a factor to three decimals, rounding up to the next cent', () => {
    expect(scaled(Money.of('300'), 1.4567).toString()).toBe('437.10');
    expect(scaled(Money.of('100.01'), 1.333).toString()).toBe('133.32');
  });
});

describe('statisticalPrice', () => {
  it('is the formula payout times the acceptance factor, in whole tens of birr', () => {
    expect(statisticalPrice(Money.of('287.35'), 1.32).toString()).toBe('380.00');
  });

  it('never goes below the formula payout', () => {
    expect(statisticalPrice(Money.of('287.35'), 0.6).toString()).toBe('287.35');
  });
});

describe('raisedPrice', () => {
  const cap = Money.of('1000');

  it('raises by 10% to the next 10 birr', () => {
    expect(raisedPrice(Money.of('380'), cap)?.toString()).toBe('420.00');
  });

  it('stops at the cap', () => {
    expect(raisedPrice(Money.of('950'), cap)?.toString()).toBe('1000.00');
    expect(raisedPrice(cap, cap)).toBeUndefined();
  });

  it('never raises a price that the owner approved above the cap', () => {
    expect(raisedPrice(Money.of('1200'), cap)).toBeUndefined();
  });

  it('never passes the cap from any starting price, however many raises', () => {
    for (let start = 50; start <= 1000; start += 37) {
      let price: Money | undefined = Money.of(String(start));
      let raises = 0;
      while (price) {
        expect(price.compare(cap)).toBeLessThanOrEqual(0);
        price = raisedPrice(price, cap);
        raises += 1;
      }
      expect(raises).toBeLessThan(40);
    }
  });
});

describe('assertOfferable', () => {
  const cap = Money.of('1000');

  it('lets any price up to the cap through', () => {
    expect(() => {
      assertOfferable(cap, cap, false);
    }).not.toThrow();
  });

  it('refuses a price above the cap without the owner, and allows it with the owner', () => {
    expect(() => {
      assertOfferable(Money.of('1000.01'), cap, false);
    }).toThrow(/needs the owner/);
    expect(() => {
      assertOfferable(Money.of('1200'), cap, true);
    }).not.toThrow();
  });
});

describe('similarTrips', () => {
  const kality = zoneOf({ latitude: 8.9, longitude: 38.77 });
  const cmc = zoneOf({ latitude: 9.02, longitude: 38.85 });
  const trip = (id: string, zone: string, routeMeters: number, at: string): PastTrip => ({
    id,
    zone,
    routeMeters,
    formulaPayout: Money.of('300'),
    heldPrice: Money.of('400'),
    raises: 0,
    at: new Date(at),
    synthetic: false,
  });

  it('ranks by destination distance plus road-distance difference, newest first on a tie', () => {
    const past = [
      trip('far-away', cmc, 14_000, '2026-11-01'),
      trip('same-zone-longer', kality, 18_000, '2026-11-01'),
      trip('same-zone-older', kality, 14_000, '2026-10-01'),
      trip('same-zone-newer', kality, 14_000, '2026-11-02'),
    ];
    const ranked = similarTrips({ zone: kality, routeMeters: 14_000 }, past, 3);
    expect(ranked.map((t) => t.id)).toEqual([
      'same-zone-newer',
      'same-zone-older',
      'same-zone-longer',
    ]);
  });
});
