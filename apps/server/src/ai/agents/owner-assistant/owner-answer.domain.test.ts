import { describe, expect, it } from 'vitest';
import { namesUnknownAmount, rowsText, todayLine } from './owner-answer.domain';

describe('todayLine', () => {
  it('gives the weekday, date, and time in Addis Ababa', () => {
    expect(todayLine(new Date('2026-11-05T21:30:00Z'))).toBe(
      '[Today in Addis Ababa: Friday 2026-11-06, 00:30]',
    );
  });
});

describe('namesUnknownAmount', () => {
  it('trusts amounts from the rows and the owner', () => {
    const rows = JSON.stringify({ rows: [{ revenue: '24500.00' }] });
    expect(namesUnknownAmount('Revenue was 24,500 birr', [rows])).toBe(false);
    expect(namesUnknownAmount('I prepared 22 birr per km', ['raise the rate to 22'])).toBe(false);
  });

  it('flags an amount nobody gave', () => {
    expect(namesUnknownAmount('Revenue was 30,000 birr', ['{"revenue":"24500.00"}'])).toBe(true);
  });
});

describe('rowsText', () => {
  it('lists the columns and the rows', () => {
    expect(
      rowsText({
        columns: ['product_title', 'units'],
        rows: [
          { product_title: 'Nike Air', units: 7 },
          { product_title: 'Samba', units: null },
        ],
      }),
    ).toBe('product_title · units\nNike Air · 7\nSamba · —');
  });

  it('says when nothing matched, and how many rows it left out', () => {
    expect(rowsText({ columns: ['a'], rows: [] })).toBe('No rows matched.');
    const many = { columns: ['n'], rows: Array.from({ length: 17 }, (_, n) => ({ n })) };
    expect(rowsText(many).split('\n').at(-1)).toBe('… and 2 more');
  });
});
