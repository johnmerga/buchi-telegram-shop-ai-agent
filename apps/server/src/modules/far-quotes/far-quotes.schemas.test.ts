import { describe, expect, it } from 'vitest';
import { farQuoteCallbackData, farQuoteCallbackSchema } from './far-quotes.schemas';

const id = '3f2a9c00-0000-4000-8000-000000000001';

describe('farQuoteCallbackSchema', () => {
  it.each(['confirm', 'decline', 'approve', 'pickup'] as const)('reads %s back', (action) => {
    expect(farQuoteCallbackSchema.parse(farQuoteCallbackData(action, id))).toEqual({ action, id });
  });

  it('rejects other actions and malformed IDs', () => {
    expect(farQuoteCallbackSchema.safeParse(`farquote:raise:${id}`).success).toBe(false);
    expect(farQuoteCallbackSchema.safeParse('farquote:confirm:42').success).toBe(false);
  });
});
