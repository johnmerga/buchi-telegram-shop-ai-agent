import { describe, expect, it } from 'vitest';
import { addisClockTime } from './time';

describe('addisClockTime', () => {
  it('shows the time of day in Addis Ababa, three hours ahead of UTC', () => {
    expect(addisClockTime(new Date('2026-11-05T15:30:00Z'))).toBe('18:30');
  });
});
