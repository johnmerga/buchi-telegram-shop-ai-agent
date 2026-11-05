import { Money } from '@buchi/shared';
import { describe, expect, it } from 'vitest';
import { mapsLink, minutesBetween, needsReview, point, suggestedBonus } from './dispatch.domain';

describe('suggestedBonus', () => {
  it('suggests a fifth of the payout, rounded up to whole tens of birr', () => {
    expect(suggestedBonus(Money.of('160')).toString()).toBe('40.00');
    expect(suggestedBonus(Money.of('251')).toString()).toBe('60.00');
  });

  it('suggests at least 20 birr for a small payout', () => {
    expect(suggestedBonus(Money.of('60')).toString()).toBe('20.00');
    expect(suggestedBonus(Money.zero).toString()).toBe('20.00');
  });
});

describe('needsReview', () => {
  it('accepts a delivery up to 300 m from the pin', () => {
    expect(needsReview(0)).toBe(false);
    expect(needsReview(300)).toBe(false);
  });

  it('flags a delivery farther than 300 m from the pin', () => {
    expect(needsReview(301)).toBe(true);
  });
});

describe('minutesBetween', () => {
  it('rounds to the nearest minute', () => {
    const start = new Date('2026-11-05T09:00:00Z');
    expect(minutesBetween(start, new Date('2026-11-05T09:24:29Z'))).toBe(24);
    expect(minutesBetween(start, new Date('2026-11-05T09:24:30Z'))).toBe(25);
  });
});

describe('mapsLink', () => {
  it('links to the pin in Google Maps', () => {
    expect(mapsLink({ latitude: 8.99706, longitude: 38.78661 })).toBe(
      'https://www.google.com/maps?q=8.99706,38.78661',
    );
  });
});

describe('point', () => {
  it('reads a pin from two columns', () => {
    expect(point(9.01, 38.76)).toEqual({ latitude: 9.01, longitude: 38.76 });
  });

  it('returns nothing when the place has no pin', () => {
    expect(point(null, null)).toBeNull();
  });
});
