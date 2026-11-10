import { describe, expect, it } from 'vitest';
import { concessionsInPlay, NEGOTIATION_RESET_MS } from './negotiation.service';

describe('concessionsInPlay', () => {
  const updatedAt = new Date('2026-11-10T08:00:00Z');

  it('keeps the concessions while the talk is recent', () => {
    const now = new Date(updatedAt.getTime() + NEGOTIATION_RESET_MS - 1);
    expect(concessionsInPlay({ concessionsMade: 2, updatedAt }, now)).toBe(2);
  });

  it('starts a new negotiation once the talk has been quiet long enough', () => {
    const now = new Date(updatedAt.getTime() + NEGOTIATION_RESET_MS);
    expect(concessionsInPlay({ concessionsMade: 2, updatedAt }, now)).toBe(0);
  });
});
