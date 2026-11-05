import { describe, expect, it } from 'vitest';
import {
  deadlineExtended,
  isNearDeadline,
  NEAR_DEADLINE_MINUTES,
  reachesWaitlistThreshold,
  WAITLIST_THRESHOLD,
} from './operations.domain';

const now = new Date('2026-11-05T12:00:00Z');
const inMinutes = (minutes: number) => new Date(now.getTime() + minutes * 60_000);

describe('isNearDeadline', () => {
  it('is near within 30 minutes before the deadline', () => {
    expect(isNearDeadline(inMinutes(NEAR_DEADLINE_MINUTES), now)).toBe(true);
    expect(isNearDeadline(inMinutes(1), now)).toBe(true);
  });

  it('is not near earlier, after the deadline, or without one', () => {
    expect(isNearDeadline(inMinutes(NEAR_DEADLINE_MINUTES + 1), now)).toBe(false);
    expect(isNearDeadline(now, now)).toBe(false);
    expect(isNearDeadline(null, now)).toBe(false);
  });
});

describe('reachesWaitlistThreshold', () => {
  it('fires only on the join that makes the threshold', () => {
    expect(reachesWaitlistThreshold(WAITLIST_THRESHOLD - 1)).toBe(false);
    expect(reachesWaitlistThreshold(WAITLIST_THRESHOLD)).toBe(true);
    expect(reachesWaitlistThreshold(WAITLIST_THRESHOLD + 1)).toBe(false);
  });
});

describe('deadlineExtended', () => {
  it('confirms the new time in Addis Ababa time', () => {
    const text = deadlineExtended('3f2a9c00-0000-4000-8000-000000000001', inMinutes(90));
    expect(text).toContain('until 16:30 (Addis Ababa time)');
    expect(text).toContain('#3F2A9C');
  });
});
