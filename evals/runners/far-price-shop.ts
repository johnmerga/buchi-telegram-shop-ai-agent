/**
 * The shop whose synthetic trips both far-price suites use: Meskel Square, the demo's delivery
 * settings, and a fixed clock, so trips, evidence, and recorded requests repeat on every run.
 */
export const evalShop = {
  origin: { latitude: 9.0108, longitude: 38.7613 },
  settings: {
    baseFee: '40',
    ratePerKm: '12.50',
    ratePerMinute: '1.50',
    freeRadiusKm: 2.5,
    standardRangeKm: 8,
    farRangeKm: 20,
    farCap: '1000.00',
    saverDiscountPercent: 15,
  },
  now: new Date('2026-11-05T09:00:00Z'),
};
