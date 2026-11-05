import { describe, expect, it } from 'vitest';
import { addisClockTime, addisDateTime, addisDay, addisInstant } from './time';

describe('addisClockTime', () => {
  it('shows the time of day in Addis Ababa, three hours ahead of UTC', () => {
    expect(addisClockTime(new Date('2026-11-05T15:30:00Z'))).toBe('18:30');
  });
});

describe('addisDateTime', () => {
  it('writes the Addis Ababa date and time', () => {
    expect(addisDateTime(new Date('2026-11-05T22:15:00Z'))).toBe('2026-11-06 01:15');
  });
});

describe('addisDay', () => {
  it('starts the day at midnight in Addis Ababa, which is 21:00 UTC the day before', () => {
    expect(addisDay(new Date('2026-11-05T15:00:00Z'))).toEqual({
      day: '2026-11-05',
      start: new Date('2026-11-04T21:00:00Z'),
      end: new Date('2026-11-05T21:00:00Z'),
    });
  });

  it('counts a late UTC evening as the next Addis Ababa day', () => {
    expect(addisDay(new Date('2026-11-05T21:30:00Z')).day).toBe('2026-11-06');
  });
});

describe('addisInstant', () => {
  it('is the UTC instant of an Addis Ababa date and time, rolling past midnight', () => {
    expect(addisInstant('2026-11-06', 16, 0)).toEqual(new Date('2026-11-06T13:00:00Z'));
    expect(addisInstant('2026-11-06', 24, 0)).toEqual(new Date('2026-11-06T21:00:00Z'));
    expect(addisInstant('2026-11-30', 28, 30)).toEqual(new Date('2026-12-01T01:30:00Z'));
  });
});
