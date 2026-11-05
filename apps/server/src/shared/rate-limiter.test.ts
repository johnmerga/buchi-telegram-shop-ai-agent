import { describe, expect, it } from 'vitest';
import { RateLimiter } from './rate-limiter';

function limiterAt(clock: { ms: number }) {
  return new RateLimiter({ limit: 2, windowMs: 60_000, now: () => new Date(clock.ms) });
}

describe('RateLimiter', () => {
  it('allows requests up to the limit in a window', () => {
    const limiter = limiterAt({ ms: 0 });
    expect(limiter.take('a')).toBe(0);
    expect(limiter.take('a')).toBe(0);
  });

  it('refuses a request over the limit and says how long to wait', () => {
    const clock = { ms: 0 };
    const limiter = limiterAt(clock);
    limiter.take('a');
    limiter.take('a');
    clock.ms = 15_000;
    expect(limiter.take('a')).toBe(45_000);
  });

  it('counts each key on its own', () => {
    const limiter = limiterAt({ ms: 0 });
    limiter.take('a');
    limiter.take('a');
    expect(limiter.take('b')).toBe(0);
  });

  it('allows requests again once the window ends', () => {
    const clock = { ms: 0 };
    const limiter = limiterAt(clock);
    limiter.take('a');
    limiter.take('a');
    clock.ms = 60_000;
    expect(limiter.take('a')).toBe(0);
    expect(limiter.take('a')).toBe(0);
    expect(limiter.take('a')).toBeGreaterThan(0);
  });
});
