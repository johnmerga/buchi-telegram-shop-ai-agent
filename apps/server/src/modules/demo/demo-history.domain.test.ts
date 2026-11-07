import { Money } from '@buchi/shared';
import { describe, expect, it } from 'vitest';
import { isDemoTelegramId } from '../../shared/demo-ids';
import { seededRandom } from '../../shared/seeded-random';
import { DEMO_REUSED_TELEBIRR_REF, planHistory, type HistoryInput } from './demo-history.domain';
import { DEMO_DELIVERY_SETTINGS } from './demo-shop.domain';

const now = new Date('2026-11-07T09:00:00Z');
const products = [
  { pricingMode: 'negotiable', price: '3200.00', lowestPrice: '2750.00' },
  { pricingMode: 'fixed', price: '2400.00', lowestPrice: null },
  { pricingMode: 'negotiable', price: '2900.00', lowestPrice: '2500.00' },
  { pricingMode: 'fixed', price: '1950.00', lowestPrice: null },
  { pricingMode: 'fixed', price: '2100.00', lowestPrice: null },
] as const;

const input = (seed: number): HistoryInput => ({
  random: seededRandom(seed),
  now,
  origin: { latitude: 9.0, longitude: 38.78 },
  settings: DEMO_DELIVERY_SETTINGS,
  products: products.map((product, index) => ({
    pricingMode: product.pricingMode,
    price: Money.of(product.price),
    lowestPrice: product.lowestPrice === null ? null : Money.of(product.lowestPrice),
    variantIds: [`variant-${String(index)}-a`, `variant-${String(index)}-b`],
  })),
  driverIds: ['driver-a', 'driver-b'],
  customers: 40,
  orders: 120,
  days: 42,
});

describe('planHistory', () => {
  const history = planHistory(input(7));

  it('gives the same history for the same seed', () => {
    expect(planHistory(input(7))).toEqual(history);
  });

  it('makes demo customers only, with made-up Telegram IDs', () => {
    expect(history.customers).toHaveLength(40);
    expect(history.customers.every((customer) => isDemoTelegramId(customer.telegramUserId))).toBe(
      true,
    );
  });

  it('places every order in the past weeks, in time order, with each step after the last', () => {
    const starts = history.orders.map((order) => order.timeline[0].at.getTime());
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    expect(Math.min(...starts)).toBeGreaterThan(now.getTime() - 43 * 24 * 60 * 60_000);
    for (const order of history.orders) {
      const times = order.timeline.map((step) => step.at.getTime());
      expect(times).toEqual([...times].sort((a, b) => a - b));
      expect(times.at(-1)).toBeLessThan(now.getTime());
    }
  });

  it('sells negotiable products within their range and fixed ones at their price', () => {
    for (const order of history.orders) {
      const index = Number(order.variantId.split('-')[1]);
      const product = input(7).products[index];
      if (!product) throw new Error('Unknown product');
      expect(order.unitPrice.compare(product.price)).toBeLessThanOrEqual(0);
      expect(order.unitPrice.compare(product.lowestPrice ?? product.price)).toBeGreaterThanOrEqual(
        0,
      );
    }
  });

  it('sells the first three products most and the last one least', () => {
    const sold = (index: number) =>
      history.orders.filter((order) => order.variantId.startsWith(`variant-${String(index)}`))
        .length;
    expect(sold(0) + sold(1) + sold(2)).toBeGreaterThan(80);
    expect(sold(4)).toBeLessThan(sold(3));
  });

  it('delivers every delivery order by trip, and each pickup at the shop', () => {
    const delivered = history.orders.filter(
      (order) => order.timeline.at(-1)?.status === 'delivered',
    );
    expect(delivered.length).toBeGreaterThan(90);
    for (const order of delivered) {
      expect(order.trip !== null).toBe(order.deliveryType !== 'pickup');
      expect(order.pin !== null).toBe(order.deliveryType !== 'pickup');
    }
  });

  it('pays every paid order, and keeps one rejected payment reported and the reused reference', () => {
    const payments = history.orders.flatMap((order) => (order.payment ? [order.payment] : []));
    expect(payments.filter((payment) => payment.reportedAt !== null)).toHaveLength(1);
    expect(payments.filter((payment) => payment.txRef === DEMO_REUSED_TELEBIRR_REF)).toHaveLength(
      1,
    );
    for (const payment of payments) {
      const format = payment.provider === 'telebirr' ? /^[A-Z0-9]{10}$/ : /^FT\d{5}[A-Z0-9]{5}$/;
      expect(payment.txRef).toMatch(format);
    }
  });
});
