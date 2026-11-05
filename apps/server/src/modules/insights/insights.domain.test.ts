import { describe, expect, it } from 'vitest';
import { seriesChart, weekOf } from './insights.domain';

describe('weekOf', () => {
  it('is the Monday of the week in Addis Ababa', () => {
    // Monday 9 November 2026, 9:00 in Addis Ababa.
    expect(weekOf(new Date('2026-11-09T06:00:00Z'))).toBe('2026-11-09');
    expect(weekOf(new Date('2026-11-15T20:00:00Z'))).toBe('2026-11-09');
  });

  it('starts a new week at midnight in Addis Ababa, not in UTC', () => {
    // Sunday 22:00 UTC is already Monday 01:00 in Addis Ababa.
    expect(weekOf(new Date('2026-11-15T22:00:00Z'))).toBe('2026-11-16');
  });
});

describe('seriesChart', () => {
  it('draws bars for labels with numbers, including numeric strings', () => {
    const chart = seriesChart(
      {
        columns: ['product_title', 'units', 'revenue'],
        rows: [
          { product_title: 'Nike Air', units: 7, revenue: '24500.00' },
          { product_title: 'Adidas Samba', units: 3, revenue: '9600.00' },
        ],
      },
      'Best sellers',
    );
    expect(chart).toMatchObject({
      type: 'bar',
      data: {
        labels: ['Nike Air', 'Adidas Samba'],
        datasets: [
          { label: 'units', data: [7, 3] },
          { label: 'revenue', data: [24500, 9600] },
        ],
      },
      options: { plugins: { title: { text: 'Best sellers' }, legend: { display: true } } },
    });
  });

  it('draws a line over dates and shortens them to days', () => {
    const chart = seriesChart(
      {
        columns: ['day', 'orders'],
        rows: [
          { day: '2026-11-02T00:00:00.000Z', orders: 4 },
          { day: '2026-11-03T00:00:00.000Z', orders: 6 },
        ],
      },
      'Orders',
    );
    expect(chart?.type).toBe('line');
    expect(chart?.data.labels).toEqual(['2026-11-02', '2026-11-03']);
  });

  it('draws nothing for one row or for columns without numbers', () => {
    expect(seriesChart({ columns: ['total'], rows: [{ total: 5 }, { total: 6 }] }, 't')).toBe(
      undefined,
    );
    expect(
      seriesChart({ columns: ['product', 'units'], rows: [{ product: 'A', units: 1 }] }, 't'),
    ).toBe(undefined);
    expect(
      seriesChart(
        {
          columns: ['product', 'size'],
          rows: [
            { product: 'A', size: 'M' },
            { product: 'B', size: null },
          ],
        },
        't',
      ),
    ).toBe(undefined);
  });
});
