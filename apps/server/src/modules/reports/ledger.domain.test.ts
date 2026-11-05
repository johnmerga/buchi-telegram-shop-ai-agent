import { describe, expect, it } from 'vitest';
import {
  cellsToAppend,
  dailySummaryRow,
  ledgerHeaders,
  retryDelayMs,
  saleRow,
  type LedgerRow,
} from './ledger.domain';

const orderId = '3d6f0a2b-1c4e-4b5a-8d7c-9e0f1a2b3c4d';

describe('saleRow', () => {
  it('writes the order with Addis Ababa time, numeric amounts, and the payment check', () => {
    const row = saleRow({
      orderId,
      orderReference: '#3D6F0A',
      paidAt: new Date('2026-11-05T15:30:00Z'),
      lines: [
        { title: 'Nike Air', size: '42', quantity: 1 },
        { title: 'Sandal', size: '38', quantity: 2 },
      ],
      deliveryFee: '130.00',
      total: '3630.00',
      payment: { provider: 'telebirr', txRef: 'CHK1234567', bankVerified: true },
    });
    expect(row).toEqual({
      key: `sale-${orderId}`,
      tab: 'Sales',
      cells: [
        `sale-${orderId}`,
        '2026-11-05 18:30',
        '#3D6F0A',
        '1 × Nike Air (42), 2 × Sandal (38)',
        130,
        3630,
        'telebirr',
        'CHK1234567',
        'yes',
      ],
    });
  });

  it('leaves the payment cells empty for an owner approval without a readable receipt', () => {
    const row = saleRow({
      orderId,
      orderReference: '#3D6F0A',
      paidAt: new Date('2026-11-05T15:30:00Z'),
      lines: [],
      deliveryFee: '0.00',
      total: '100.00',
      payment: { provider: null, txRef: null, bankVerified: false },
    });
    expect(row.cells.slice(6)).toEqual(['', '', 'no']);
  });
});

describe('dailySummaryRow', () => {
  it('keys the row by day, so one day has one summary row', () => {
    const row = dailySummaryRow({
      day: '2026-11-05',
      ordersCreated: 7,
      ordersPaid: 5,
      revenue: '17500.00',
      deliveryCost: '450.50',
      saverSavings: '120.00',
      fraudBlocked: 1,
      fraudBlockedAmount: '3500.00',
      openReviews: 2,
    });
    expect(row.key).toBe('day-2026-11-05');
    expect(row.tab).toBe('Daily');
    expect(row.cells).toEqual([
      'day-2026-11-05',
      '2026-11-05',
      7,
      5,
      17500,
      450.5,
      120,
      1,
      3500,
      2,
    ]);
    expect(row.cells).toHaveLength(ledgerHeaders.Daily.length);
  });
});

describe('retryDelayMs', () => {
  it('doubles from one minute', () => {
    expect([1, 2, 3, 4].map(retryDelayMs)).toEqual([60_000, 120_000, 240_000, 480_000]);
  });

  it('never waits longer than six hours', () => {
    expect(retryDelayMs(30)).toBe(6 * 60 * 60_000);
  });
});

describe('cellsToAppend', () => {
  const row = (key: string): LedgerRow => ({ key, tab: 'Sales', cells: [key, 'x'] });

  it('starts an empty tab with its header row', () => {
    expect(cellsToAppend('Sales', [row('a')], new Set())).toEqual([
      ledgerHeaders.Sales,
      ['a', 'x'],
    ]);
  });

  it('skips rows that an earlier attempt already appended', () => {
    const inSheet = new Set(['Buchi ID', 'a']);
    expect(cellsToAppend('Sales', [row('a'), row('b')], inSheet)).toEqual([['b', 'x']]);
  });

  it('appends nothing, not even a header, when every row is already there', () => {
    expect(cellsToAppend('Sales', [row('a')], new Set(['Buchi ID', 'a']))).toEqual([]);
  });
});
