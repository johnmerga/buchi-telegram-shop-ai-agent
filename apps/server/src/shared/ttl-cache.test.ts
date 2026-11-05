import { describe, expect, it } from 'vitest';
import { TtlCache } from './ttl-cache';

function cacheAt(start: number, maxEntries = 10) {
  const clock = { time: start };
  const cache = new TtlCache<string>({
    ttlMs: 1000,
    maxEntries,
    now: () => new Date(clock.time),
  });
  return { cache, clock };
}

describe('TtlCache', () => {
  it('returns a value until it expires', () => {
    const { cache, clock } = cacheAt(0);
    cache.set('a', 'one');
    clock.time = 999;
    expect(cache.get('a')).toBe('one');
    clock.time = 1000;
    expect(cache.get('a')).toBeUndefined();
  });

  it('drops the oldest entry when it is full', () => {
    const { cache } = cacheAt(0, 2);
    cache.set('a', 'one');
    cache.set('b', 'two');
    cache.set('c', 'three');
    expect([cache.get('a'), cache.get('b'), cache.get('c')]).toEqual([undefined, 'two', 'three']);
  });

  it('refreshes an entry that is set again', () => {
    const { cache, clock } = cacheAt(0, 2);
    cache.set('a', 'one');
    cache.set('b', 'two');
    clock.time = 500;
    cache.set('a', 'again');
    cache.set('c', 'three');
    clock.time = 1200;
    expect([cache.get('a'), cache.get('b'), cache.get('c')]).toEqual(['again', undefined, 'three']);
  });
});
