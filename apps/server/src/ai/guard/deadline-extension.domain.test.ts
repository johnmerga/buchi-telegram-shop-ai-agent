import { describe, expect, it } from 'vitest';
import { checkDeadlineExtension } from './deadline-extension.domain';

describe('checkDeadlineExtension', () => {
  it.each([1, 90, 120])('accepts a first extension of %i minutes', (minutes) => {
    expect(checkDeadlineExtension(minutes, 0)).toEqual({
      result: 'accepted',
      reason: 'within_limits',
      value: minutes,
    });
  });

  it('sends a first extension longer than two hours to the owner', () => {
    expect(checkDeadlineExtension(121, 0)).toEqual({ result: 'needs_owner', reason: 'too_long' });
  });

  it('sends a second extension to the owner, however short', () => {
    expect(checkDeadlineExtension(10, 1)).toEqual({
      result: 'needs_owner',
      reason: 'already_extended',
    });
  });

  it.each([0, -30, 1.5])('refuses %d minutes as an extension', (minutes) => {
    expect(() => checkDeadlineExtension(minutes, 0)).toThrow(RangeError);
  });
});
