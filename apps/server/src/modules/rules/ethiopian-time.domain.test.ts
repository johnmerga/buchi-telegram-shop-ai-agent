import { describe, expect, it } from 'vitest';
import { ethiopianClockText, westernTime } from './ethiopian-time.domain';

describe('westernTime', () => {
  it('reads "ከ10 ሰዓት በኋላ" as 4:00 PM', () => {
    expect(westernTime({ hour: 10, minute: 0 })).toEqual({ hour: 16, minute: 0, nextDay: false });
  });

  it.each([
    [{ hour: 12, minute: 0 }, 6],
    [{ hour: 1, minute: 30 }, 7],
    [{ hour: 6, minute: 0 }, 12],
    [{ hour: 11, minute: 0 }, 17],
  ])('puts %o without a period word in the daytime half', (time, hour) => {
    expect(westernTime(time).hour).toBe(hour);
  });

  it('reads ጠዋት and ከሰዓት in the daytime half', () => {
    expect(westernTime({ hour: 2, minute: 0, period: 'morning' }).hour).toBe(8);
    expect(westernTime({ hour: 8, minute: 0, period: 'afternoon' }).hour).toBe(14);
  });

  it('reads ማታ in the evening of the same day', () => {
    expect(westernTime({ hour: 12, minute: 0, period: 'evening' })).toEqual({
      hour: 18,
      minute: 0,
      nextDay: false,
    });
    expect(westernTime({ hour: 3, minute: 15, period: 'evening' }).hour).toBe(21);
  });

  it('reads ሌሊት after midnight as the next day', () => {
    expect(westernTime({ hour: 6, minute: 0, period: 'night' })).toEqual({
      hour: 0,
      minute: 0,
      nextDay: true,
    });
    expect(westernTime({ hour: 10, minute: 0, period: 'night' })).toEqual({
      hour: 4,
      minute: 0,
      nextDay: true,
    });
  });

  it.each([0, 13, 2.5])('rejects the hour %d', (hour) => {
    expect(() => westernTime({ hour, minute: 0 })).toThrow(RangeError);
  });
});

describe('ethiopianClockText', () => {
  it.each([
    [16, 0, 'ከቀኑ 10 ሰዓት'],
    [18, 0, 'ከምሽቱ 12 ሰዓት'],
    [8, 0, 'ከጠዋቱ 2 ሰዓት'],
    [6, 0, 'ከጠዋቱ 12 ሰዓት'],
    [0, 0, 'ከሌሊቱ 6 ሰዓት'],
    [21, 30, 'ከምሽቱ 3:30 ሰዓት'],
  ])('says %d:%d as %s', (hour, minute, text) => {
    expect(ethiopianClockText(hour, minute)).toBe(text);
  });

  it('round-trips with westernTime', () => {
    expect(ethiopianClockText(westernTime({ hour: 10, minute: 0 }).hour, 0)).toBe('ከቀኑ 10 ሰዓት');
  });
});
