import { describe, expect, it } from 'vitest';
import { reachesWaitlistThreshold, WAITLIST_THRESHOLD } from './operations.domain';

describe('reachesWaitlistThreshold', () => {
  it('fires only on the join that makes the threshold', () => {
    expect(reachesWaitlistThreshold(WAITLIST_THRESHOLD - 1)).toBe(false);
    expect(reachesWaitlistThreshold(WAITLIST_THRESHOLD)).toBe(true);
    expect(reachesWaitlistThreshold(WAITLIST_THRESHOLD + 1)).toBe(false);
  });
});
