import { describe, expect, it } from 'vitest';
import {
  clipRatio,
  learnFactors,
  lookupFactor,
  meanAbsoluteError,
  recencyWeight,
  shrunkFactor,
  timeBand,
} from './factors.domain';

const now = new Date('2026-11-05T09:00:00Z');
const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60_000);

describe('timeBand', () => {
  it.each([
    ['2026-11-05T04:00:00Z', 'peak'], // 07:00 in Addis Ababa
    ['2026-11-05T06:59:00Z', 'peak'], // 09:59
    ['2026-11-05T07:00:00Z', 'off_peak'], // 10:00
    ['2026-11-05T13:00:00Z', 'peak'], // 16:00
    ['2026-11-05T17:00:00Z', 'off_peak'], // 20:00
    ['2026-11-05T21:30:00Z', 'off_peak'], // 00:30 the next day
  ])('puts %s in the %s band', (at, band) => {
    expect(timeBand(new Date(at))).toBe(band);
  });
});

describe('clipRatio', () => {
  it('keeps a ratio between 0.5 and 4', () => {
    expect(clipRatio(1.7)).toBe(1.7);
  });

  it('clips a ratio below 0.5 and above 4', () => {
    expect(clipRatio(0.1)).toBe(0.5);
    expect(clipRatio(12)).toBe(4);
  });
});

describe('recencyWeight', () => {
  it('weighs a trip from now fully, and halves the weight every 30 days', () => {
    expect(recencyWeight(now, now)).toBe(1);
    expect(recencyWeight(daysAgo(30), now)).toBeCloseTo(0.5);
    expect(recencyWeight(daysAgo(60), now)).toBeCloseTo(0.25);
  });

  it('never weighs a trip from the future more than one from now', () => {
    expect(recencyWeight(daysAgo(-3), now)).toBe(1);
  });
});

describe('shrunkFactor', () => {
  it('stays at the parent factor without trips', () => {
    expect(shrunkFactor([], 1.3, now)).toBeCloseTo(1.3);
  });

  it('follows the formula exp((Σ wᵢ·ln rᵢ + 5·ln f_parent) ÷ (Σ wᵢ + 5))', () => {
    const observations = [
      { ratio: 2, at: now },
      { ratio: 1.5, at: daysAgo(30) },
    ];
    const expected = Math.exp((Math.log(2) + 0.5 * Math.log(1.5) + 5 * Math.log(1.2)) / 6.5);
    expect(shrunkFactor(observations, 1.2, now)).toBeCloseTo(expected, 10);
  });

  it('moves toward the trips as they add up', () => {
    const trips = (n: number) => Array.from({ length: n }, () => ({ ratio: 2, at: now }));
    expect(shrunkFactor(trips(5), 1, now)).toBeCloseTo(Math.SQRT2);
    expect(shrunkFactor(trips(500), 1, now)).toBeGreaterThan(1.98);
  });

  it('clips each ratio, so one extreme trip moves the factor only so far', () => {
    expect(shrunkFactor([{ ratio: 100, at: now }], 1, now)).toBeCloseTo(4 ** (1 / 6));
  });
});

describe('learnFactors', () => {
  const trip = (ratio: number, zones: string[]) => ({ ratio, at: now, zones });

  it('shrinks the broadest zone toward 1 and each smaller zone toward the zone around it', () => {
    const learned = learnFactors(
      [trip(2, ['all', 'parent', 'zone']), trip(2, ['all', 'parent', 'zone'])],
      now,
    );
    const all = Math.exp((2 * Math.log(2)) / 7);
    const parent = Math.exp((2 * Math.log(2) + 5 * Math.log(all)) / 7);
    const zone = Math.exp((2 * Math.log(2) + 5 * Math.log(parent)) / 7);
    expect(learned.map((factor) => [factor.zone, factor.trips])).toEqual([
      ['all', 2],
      ['parent', 2],
      ['zone', 2],
    ]);
    const [learnedAll, learnedParent, learnedZone] = learned.map((factor) => factor.factor);
    expect(learnedAll).toBeCloseTo(all, 10);
    expect(learnedParent).toBeCloseTo(parent, 10);
    expect(learnedZone).toBeCloseTo(zone, 10);
  });

  it('learns nothing from no trips', () => {
    expect(learnFactors([], now)).toEqual([]);
  });
});

describe('lookupFactor', () => {
  const learned = new Map([
    ['parent', { factor: 1.4, trips: 9 }],
    ['all', { factor: 1.1, trips: 40 }],
  ]);

  it("returns a zone's own factor when it has trips", () => {
    const withZone = new Map([...learned, ['zone', { factor: 1.8, trips: 3 }]]);
    expect(lookupFactor(['zone', 'parent', 'all'], withZone)).toEqual({
      factor: 1.8,
      trips: 3,
      from: 'zone',
    });
  });

  it("returns the parent's factor for a zone with no trips", () => {
    expect(lookupFactor(['zone', 'parent', 'all'], learned)).toEqual({
      factor: 1.4,
      trips: 9,
      from: 'parent',
    });
  });

  it('falls back to the broadest zone, then to the formula itself', () => {
    expect(lookupFactor(['zone', 'other', 'all'], learned).from).toBe('all');
    expect(lookupFactor(['zone'], learned)).toEqual({ factor: 1, trips: 0, from: null });
  });
});

describe('meanAbsoluteError', () => {
  it('averages each error as a share of what happened', () => {
    expect(
      meanAbsoluteError([
        { estimate: 90, actual: 100 },
        { estimate: 300, actual: 200 },
      ]),
    ).toBeCloseTo(0.3);
  });

  it('is zero without estimates', () => {
    expect(meanAbsoluteError([])).toBe(0);
  });
});
