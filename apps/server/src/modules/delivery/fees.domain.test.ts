import { Money, type DeliverySettings } from '@buchi/shared';
import { describe, expect, it } from 'vitest';
import type { Route } from './distance.domain';
import {
  deliveryArea,
  driverPayout,
  expressFee,
  quoteDelivery,
  saverFee,
  tripCost,
} from './fees.domain';

const settings: DeliverySettings = {
  baseFee: '50',
  ratePerKm: '15',
  ratePerMinute: '2',
  freeRadiusKm: 3,
  standardRangeKm: 8,
  farRangeKm: 20,
  farCap: '1000',
  saverDiscountPercent: 20,
};

const road = (meters: number, seconds = 600): Route => ({ meters, seconds, approximate: false });
const amounts = (quote: ReturnType<typeof quoteDelivery>) =>
  quote.options.map((o) => ({ type: o.type, fee: o.fee.toString(), payout: o.payout.toString() }));

describe('deliveryArea', () => {
  it.each([
    [0, 'free'],
    [3000, 'free'],
    [3001, 'standard'],
    [8000, 'standard'],
    [8001, 'far'],
    [20_000, 'far'],
    [20_001, 'beyond'],
  ] as const)('puts %i m in the %s area', (meters, area) => {
    expect(deliveryArea(meters, settings)).toBe(area);
  });

  it('handles fractional kilometres exactly', () => {
    const ranges = { ...settings, freeRadiusKm: 2.3, standardRangeKm: 8.1 };
    expect(deliveryArea(2300, ranges)).toBe('free');
    expect(deliveryArea(2301, ranges)).toBe('standard');
    expect(deliveryArea(8100, ranges)).toBe('standard');
  });

  it('skips the free area when the free radius is zero', () => {
    expect(deliveryArea(1, { ...settings, freeRadiusKm: 0 })).toBe('standard');
  });
});

describe('driverPayout', () => {
  it('adds the base fee, the distance, and the expected minutes', () => {
    // 50 + 15 × 5.37 km + 2 × 14.5 min = 50 + 80.55 + 29 = 159.55
    expect(driverPayout(road(5370, 870), 1, settings).toString()).toBe('159.55');
  });

  it('multiplies the routing time by the zone time factor', () => {
    // 50 + 15 × 5 km + 2 × (10 min × 1.5) = 50 + 75 + 30
    expect(driverPayout(road(5000, 600), 1.5, settings).toString()).toBe('155.00');
  });

  it('rounds each part up to the next cent', () => {
    // 15 × 0.001 km = 0.015 → 0.02, and 2 × 1 s = 0.0333 → 0.04
    expect(driverPayout(road(1, 1), 1, { ...settings, baseFee: '0' }).toString()).toBe('0.06');
  });
});

describe('tripCost', () => {
  it('pays one leg exactly as driverPayout does', () => {
    const trip = tripCost([{ meters: 6000, seconds: 900, timeFactor: 1.5 }], settings);
    expect(trip.payout.toString()).toBe(driverPayout(road(6000, 900), 1.5, settings).toString());
  });

  it("scales each leg by its own zone's factor and keeps both times per leg", () => {
    const trip = tripCost(
      [
        { meters: 4000, seconds: 600, timeFactor: 1.5 },
        { meters: 2000, seconds: 300, timeFactor: 1 },
      ],
      settings,
    );
    expect(trip).toMatchObject({ meters: 6000, expectedMinutes: 20 });
    expect(trip.legs).toEqual([
      { routingSeconds: 600, expectedSeconds: 900 },
      { routingSeconds: 300, expectedSeconds: 300 },
    ]);
  });
});

describe('expressFee', () => {
  it.each([
    ['159.55', '160.00'],
    ['150.01', '160.00'],
    ['150.00', '150.00'],
    ['0.00', '0.00'],
  ])('rounds a payout of %s up to %s', (payout, fee) => {
    expect(expressFee(Money.of(payout)).toString()).toBe(fee);
  });
});

describe('saverFee', () => {
  it.each([
    ['160', 20, '120.00'],
    ['150', 20, '120.00'],
    ['100', 5, '90.00'],
    ['100', 0, '100.00'],
    ['100', 90, '10.00'],
    ['0', 20, '0.00'],
  ])('gives %s birr Express with %i%% off a Saver fee of %s', (express, percent, saver) => {
    expect(saverFee(Money.of(express), percent).toString()).toBe(saver);
  });
});

describe('quoteDelivery', () => {
  it('makes delivery free inside the free radius but still computes the payout', () => {
    expect(amounts(quoteDelivery(road(2000, 300), 1, settings))).toEqual([
      { type: 'free', fee: '0.00', payout: '90.00' },
      { type: 'pickup', fee: '0.00', payout: '0.00' },
    ]);
  });

  it('offers Express, Saver, and pickup in the standard range', () => {
    const quote = quoteDelivery(road(5000, 900), 1, settings);
    expect(quote.area).toBe('standard');
    expect(amounts(quote)).toEqual([
      { type: 'express', fee: '160.00', payout: '155.00' },
      { type: 'saver', fee: '120.00', payout: '155.00' },
      { type: 'pickup', fee: '0.00', payout: '0.00' },
    ]);
  });

  it('offers only pickup in the far range and beyond', () => {
    for (const meters of [15_000, 25_000]) {
      expect(amounts(quoteDelivery(road(meters), 1, settings))).toEqual([
        { type: 'pickup', fee: '0.00', payout: '0.00' },
      ]);
    }
    expect(quoteDelivery(road(15_000), 1, settings).area).toBe('far');
    expect(quoteDelivery(road(25_000), 1, settings).area).toBe('beyond');
  });

  it('passes on whether the distance is approximate', () => {
    const route = { meters: 5000, seconds: 720, approximate: true };
    expect(quoteDelivery(route, 1, settings).route).toBe(route);
  });
});
