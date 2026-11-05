import { describe, expect, it } from 'vitest';
import { RequestSpacer } from './request-spacer';

function setup() {
  const clock = { time: 10_000 };
  const waits: number[] = [];
  const starts: number[] = [];
  const spacer = new RequestSpacer(
    1000,
    () => new Date(clock.time),
    (ms) => {
      waits.push(ms);
      clock.time += ms;
      return Promise.resolve();
    },
  );
  const call = (value: string) => () => {
    starts.push(clock.time);
    return Promise.resolve(value);
  };
  return { spacer, clock, waits, starts, call };
}

describe('RequestSpacer', () => {
  it('starts the first call at once and spaces the next ones one interval apart', async () => {
    const { spacer, starts, waits, call } = setup();
    const results = await Promise.all([
      spacer.run(call('a')),
      spacer.run(call('b')),
      spacer.run(call('c')),
    ]);
    expect(results).toEqual(['a', 'b', 'c']);
    expect(starts).toEqual([10_000, 11_000, 12_000]);
    expect(waits).toEqual([1000, 1000]);
  });

  it('does not wait when the interval has already passed', async () => {
    const { spacer, clock, waits, call } = setup();
    await spacer.run(call('a'));
    clock.time += 5000;
    await spacer.run(call('b'));
    expect(waits).toEqual([]);
  });

  it('keeps going after a failed call', async () => {
    const { spacer, call } = setup();
    await expect(spacer.run(() => Promise.reject(new Error('down')))).rejects.toThrow('down');
    await expect(spacer.run(call('b'))).resolves.toBe('b');
  });
});
