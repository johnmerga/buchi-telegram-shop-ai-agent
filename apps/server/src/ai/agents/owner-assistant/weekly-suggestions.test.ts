import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../../../shared/errors';
import { WeeklySuggestions } from './weekly-suggestions';

describe('WeeklySuggestions', () => {
  it('skips each shop without suggestions, and without failing the job, when Gemini fails', async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(new AppError('QUOTA_EXHAUSTED', 'No Gemini quota left'))
      .mockRejectedValueOnce(new Error('Gemini is down'));
    const send = vi.fn();
    const requestOwnerConfirmation = vi.fn();
    const weekly = new WeeklySuggestions(
      { run },
      {
        shopsForWeeklySuggestions: () => Promise.resolve(['shop-a', 'shop-b']),
        claimWeek: () => Promise.resolve(true),
      },
      { requestOwnerConfirmation },
      { requestFor: vi.fn() },
      { send },
      pino({ level: 'silent' }),
      () => new Date('2026-11-09T06:00:00Z'),
    );

    expect(await weekly.run()).toEqual({ shops: 2, suggestions: 0, dropped: 0 });
    expect(run).toHaveBeenCalledTimes(2);
    expect(send).not.toHaveBeenCalled();
    expect(requestOwnerConfirmation).not.toHaveBeenCalled();
  });
});
