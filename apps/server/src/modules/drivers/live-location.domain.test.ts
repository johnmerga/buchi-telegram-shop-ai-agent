import { describe, expect, it } from 'vitest';
import {
  customerLivePeriod,
  freshLivePoint,
  INDEFINITE_LIVE_PERIOD,
  liveShareOf,
  tooSoon,
} from './live-location.domain';

const now = new Date('2026-11-07T09:00:00Z');
const seconds = (date: Date) => date.getTime() / 1000;
const ago = (ms: number) => new Date(now.getTime() - ms);
const pin = { latitude: 9.01, longitude: 38.76 };

describe('liveShareOf', () => {
  it('ends the share at the message date plus its live period', () => {
    const share = liveShareOf({ date: seconds(now), location: { ...pin, live_period: 900 } });
    expect(share).toEqual({ point: pin, until: new Date('2026-11-07T09:15:00Z') });
  });

  it('has no end for a share until stopped', () => {
    const location = { ...pin, live_period: INDEFINITE_LIVE_PERIOD };
    expect(liveShareOf({ date: seconds(now), location })).toEqual({ point: pin, until: null });
  });

  it('reads an edit without a live period as sharing that stopped', () => {
    expect(liveShareOf({ date: seconds(now), location: pin })).toEqual({ stopped: true });
  });
});

describe('customerLivePeriod', () => {
  it('lasts as long as the driver still shares', () => {
    expect(customerLivePeriod(new Date('2026-11-07T09:30:00Z'), now)).toBe(1800);
  });

  it("stays within Telegram's one minute to one day", () => {
    expect(customerLivePeriod(new Date('2026-11-07T09:00:20Z'), now)).toBe(60);
    expect(customerLivePeriod(new Date('2026-11-09T09:00:00Z'), now)).toBe(86_400);
  });

  it('is indefinite when the driver shares until stopped', () => {
    expect(customerLivePeriod(null, now)).toBe(INDEFINITE_LIVE_PERIOD);
  });
});

describe('tooSoon', () => {
  it('skips an update within ten seconds of the last one', () => {
    expect(tooSoon(ago(9_000), now)).toBe(true);
    expect(tooSoon(ago(10_000), now)).toBe(false);
    expect(tooSoon(null, now)).toBe(false);
  });
});

describe('freshLivePoint', () => {
  const job = (liveAt: Date | null, liveUntil: Date | null = null) => ({
    liveLatitude: liveAt && pin.latitude,
    liveLongitude: liveAt && pin.longitude,
    liveAt,
    liveUntil,
  });

  it('is the point from the last two minutes', () => {
    expect(freshLivePoint(job(ago(120_000)), now)).toEqual(pin);
  });

  it('is nothing once the point is older, or the share ended', () => {
    expect(freshLivePoint(job(ago(121_000)), now)).toBeNull();
    expect(freshLivePoint(job(ago(1_000), ago(1)), now)).toBeNull();
    expect(freshLivePoint(job(null), now)).toBeNull();
  });
});
