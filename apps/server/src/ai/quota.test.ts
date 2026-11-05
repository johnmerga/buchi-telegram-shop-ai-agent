import { describe, expect, it } from 'vitest';
import { QuotaManager } from './quota';

function clock(start: string) {
  let time = new Date(start).getTime();
  return {
    now: () => new Date(time),
    advance: (ms: number) => {
      time += ms;
    },
  };
}

describe('QuotaManager', () => {
  it('stops low priorities first and keeps room for payment checks', () => {
    const quota = new QuotaManager(
      { requestsPerMinute: 10, requestsPerDay: 1000 },
      clock('2026-11-05T10:00:00Z').now,
    );

    for (let i = 0; i < 6; i += 1) quota.acquire('owner');
    expect(() => {
      quota.acquire('owner');
    }).toThrow(expect.objectContaining({ code: 'QUOTA_EXHAUSTED' }));
    for (let i = 0; i < 3; i += 1) quota.acquire('customer');
    expect(() => {
      quota.acquire('customer');
    }).toThrow(expect.objectContaining({ code: 'QUOTA_EXHAUSTED' }));
    quota.acquire('payment');
    expect(() => {
      quota.acquire('payment');
    }).toThrow(expect.objectContaining({ code: 'QUOTA_EXHAUSTED' }));
  });

  it('frees minute quota as requests age out of the window', () => {
    const time = clock('2026-11-05T10:00:00Z');
    const quota = new QuotaManager({ requestsPerMinute: 2, requestsPerDay: 1000 }, time.now);
    quota.acquire('payment');
    quota.acquire('payment');
    expect(() => {
      quota.acquire('payment');
    }).toThrow();

    time.advance(60_000);
    expect(() => {
      quota.acquire('payment');
    }).not.toThrow();
  });

  it('resets the daily count at midnight Pacific time, not UTC', () => {
    // 07:59 UTC is 23:59 the previous day in Los Angeles (PST, UTC-8, in November).
    const time = clock('2026-11-05T07:59:00Z');
    const quota = new QuotaManager({ requestsPerMinute: 100, requestsPerDay: 1 }, time.now);
    quota.acquire('payment');

    time.advance(30_000);
    expect(() => {
      quota.acquire('payment');
    }).toThrow();
    time.advance(60_000);
    expect(() => {
      quota.acquire('payment');
    }).not.toThrow();
  });
});
