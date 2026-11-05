import { AppError } from '../shared/errors';
import type { Priority } from './language-model';

export interface QuotaLimits {
  requestsPerMinute: number;
  requestsPerDay: number;
}

/**
 * The share of each limit that a priority leaves for the priorities above it. Payment checks can
 * use the whole quota, so they keep working after owner questions and problem handling stop.
 */
const reservedAbove: Record<Priority, number> = {
  payment: 0,
  customer: 0.1,
  operations: 0.25,
  owner: 0.4,
};

const MINUTE_MS = 60_000;

/** The free tier's daily quota resets at midnight Pacific time. */
const pacificDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' });

/**
 * Counts Gemini requests in a sliding one-minute window and per Pacific day. The counts live in
 * memory, because one Render instance makes every call; a restart forgets them, which errs on
 * the side of Gemini's own rate limiting.
 */
export class QuotaManager {
  private recent: number[] = [];
  private day = { date: '', count: 0 };

  constructor(
    private readonly limits: QuotaLimits,
    private readonly now: () => Date,
  ) {}

  /** Records one request, or throws QUOTA_EXHAUSTED if this priority has no room left. */
  acquire(priority: Priority): void {
    const now = this.now();
    const date = pacificDate.format(now);
    if (this.day.date !== date) this.day = { date, count: 0 };
    this.recent = this.recent.filter((time) => now.getTime() - time < MINUTE_MS);

    const share = 1 - reservedAbove[priority];
    if (
      this.recent.length + 1 > this.limits.requestsPerMinute * share ||
      this.day.count + 1 > this.limits.requestsPerDay * share
    ) {
      throw new AppError('QUOTA_EXHAUSTED', `No Gemini quota left for ${priority} requests`);
    }
    this.recent.push(now.getTime());
    this.day.count += 1;
  }
}
