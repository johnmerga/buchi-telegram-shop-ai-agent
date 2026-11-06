import { Money } from '@buchi/shared';
import { describe, expect, it } from 'vitest';
import {
  cbeReferenceMatchesDate,
  chargesAddUp,
  isCompleted,
  parsePrintedAmount,
  parsePrintedTime,
  parseReference,
  providerOf,
} from './receipt-layouts.domain';

const utc = (iso: string) => new Date(iso);

describe('parsePrintedTime', () => {
  it('reads the Telebirr app time as year/day/month', () => {
    expect(parsePrintedTime('telebirr_app', '2026/06/11 11:20:04')).toEqual(
      utc('2026-11-06T08:20:04Z'),
    );
  });

  it("reads the Telebirr app's payment screen time as year/month/day", () => {
    expect(parsePrintedTime('telebirr_app_success', '2026/11/07 01:54:27')).toEqual(
      new Date('2026-11-06T22:54:27Z'),
    );
    expect(parsePrintedTime('telebirr_app_success', '2026/31/10 01:54:27')).toBeUndefined();
  });

  it('reads the Telebirr web receipt time as day-month-year', () => {
    expect(parsePrintedTime('telebirr_web', '06-11-2026 11:20:04')).toEqual(
      utc('2026-11-06T08:20:04Z'),
    );
  });

  it('reads the CBE app time with a month name, a two-digit year, and AM or PM', () => {
    expect(parsePrintedTime('cbe_app', '06-Nov-26 5:06 PM')).toEqual(utc('2026-11-06T14:06:00Z'));
    expect(parsePrintedTime('cbe_app', '01-Nov-26 12:10 AM')).toEqual(utc('2026-10-31T21:10:00Z'));
  });

  it('reads the CBE web receipt time', () => {
    expect(parsePrintedTime('cbe_web', 'Jul 5, 2026, 11:17 AM')).toEqual(
      utc('2026-07-05T08:17:00Z'),
    );
  });

  it('reads the CBE PDF time as month/day/year', () => {
    expect(parsePrintedTime('cbe_pdf', '7/3/2026, 8:16:00 PM')).toEqual(
      utc('2026-07-03T17:16:00Z'),
    );
    expect(parsePrintedTime('cbe_pdf', '7/3/2026,  12:16:00 PM')).toEqual(
      utc('2026-07-03T09:16:00Z'),
    );
  });

  it('rejects another layout format and dates that do not exist', () => {
    expect(parsePrintedTime('telebirr_app', '06-11-2026 11:20:04')).toBeUndefined();
    expect(parsePrintedTime('telebirr_app', '2026/31/02 11:20:04')).toBeUndefined();
    expect(parsePrintedTime('telebirr_web', '06-11-2026 24:20:04')).toBeUndefined();
    expect(parsePrintedTime('cbe_app', '06-Nox-26 5:06 PM')).toBeUndefined();
    expect(parsePrintedTime('cbe_web', 'Jul 5, 2026, 13:17 PM')).toBeUndefined();
    expect(parsePrintedTime('cbe_pdf', '13/3/2026, 8:16:00 PM')).toBeUndefined();
  });
});

describe('parsePrintedAmount', () => {
  it('reads debits, thousands commas, and both currency words', () => {
    expect(parsePrintedAmount('-3,500.00 ETB')?.toString()).toBe('3500.00');
    expect(parsePrintedAmount('20 Birr')?.toString()).toBe('20.00');
    expect(parsePrintedAmount('-19.00 (ETB)')?.toString()).toBe('19.00');
    expect(parsePrintedAmount('1000.61')?.toString()).toBe('1000.61');
    expect(parsePrintedAmount('1,234,567.5 ETB')?.toString()).toBe('1234567.50');
  });

  it('rejects text, misplaced commas, and three decimals', () => {
    expect(parsePrintedAmount('ETB')).toBeUndefined();
    expect(parsePrintedAmount('35,00.00 ETB')).toBeUndefined();
    expect(parsePrintedAmount('20.005 ETB')).toBeUndefined();
  });
});

describe('parseReference', () => {
  it('accepts a Telebirr transaction number of ten capitals and digits', () => {
    expect(parseReference('telebirr', 'QX41ZB7KM2')).toBe('QX41ZB7KM2');
    expect(parseReference('telebirr', 'QX41ZB7KM')).toBeUndefined();
  });

  it('accepts a CBE reference with a real day of the year, without spaces', () => {
    expect(parseReference('cbe_bank', 'FT26310 AB12C')).toBe('FT26310AB12C');
    expect(parseReference('cbe_bank', 'FT26367AB12C')).toBeUndefined();
    expect(parseReference('cbe_bank', 'FT26000AB12C')).toBeUndefined();
    expect(parseReference('cbe_bank', 'TT26310AB12C')).toBeUndefined();
  });
});

describe('cbeReferenceMatchesDate', () => {
  it("accepts the payment's own day of the year", () => {
    expect(cbeReferenceMatchesDate('FT26310AB12C', utc('2026-11-06T14:06:00Z'))).toBe(true);
  });

  it('accepts the next day, because evening transfers post the day after', () => {
    expect(cbeReferenceMatchesDate('FT26306AB12C', utc('2026-11-01T17:28:00Z'))).toBe(true);
  });

  it('uses the Addis Ababa date, not the UTC date', () => {
    // 22:30 UTC on 5 November is 01:30 on 6 November in Addis Ababa: day 310.
    expect(cbeReferenceMatchesDate('FT26310AB12C', utc('2026-11-05T22:30:00Z'))).toBe(true);
  });

  it('rejects any other day or year', () => {
    expect(cbeReferenceMatchesDate('FT26309AB12C', utc('2026-11-06T14:06:00Z'))).toBe(false);
    expect(cbeReferenceMatchesDate('FT25310AB12C', utc('2026-11-06T14:06:00Z'))).toBe(false);
  });

  it('crosses into the next year on 31 December', () => {
    expect(cbeReferenceMatchesDate('FT27001AB12C', utc('2026-12-31T18:00:00Z'))).toBe(true);
  });
});

describe('chargesAddUp', () => {
  const money = (amount: string) => Money.of(amount);

  it('accepts a total that is the amount plus its charges', () => {
    expect(chargesAddUp(money('1000.00'), [money('0.53'), money('0.08')], money('1000.61'))).toBe(
      true,
    );
  });

  it("accepts Telebirr's total rounded to whole birr", () => {
    expect(chargesAddUp(money('20.00'), [money('0.87')], money('21.00'))).toBe(true);
  });

  it('rejects an amount that does not fit the total', () => {
    expect(chargesAddUp(money('1500.00'), [money('0.53')], money('1000.61'))).toBe(false);
  });
});

describe('providerOf and isCompleted', () => {
  it('maps each layout to its provider', () => {
    expect(providerOf('telebirr_app')).toBe('telebirr');
    expect(providerOf('cbe_pdf')).toBe('cbe_bank');
  });

  it('reads the printed status in any case', () => {
    expect(isCompleted('COMPLETED')).toBe(true);
    expect(isCompleted('Successful')).toBe(true);
    expect(isCompleted('success')).toBe(true);
    expect(isCompleted('Pending')).toBe(false);
  });
});
