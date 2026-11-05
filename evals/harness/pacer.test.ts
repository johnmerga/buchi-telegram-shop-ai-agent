import { describe, expect, it } from 'vitest';
import { Pacer } from './pacer';

describe('Pacer', () => {
  it('lets the first call through and spaces the next ones by the interval', async () => {
    let now = 1_000;
    const waits: number[] = [];
    const pacer = new Pacer(
      6_000,
      () => now,
      (ms) => {
        waits.push(ms);
        now += ms;
        return Promise.resolve();
      },
    );

    await pacer.turn();
    now += 2_000;
    await pacer.turn();
    now += 10_000;
    await pacer.turn();

    expect(waits).toEqual([4_000]);
  });
});
