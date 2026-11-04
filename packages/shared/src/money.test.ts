import { describe, expect, it } from 'vitest';
import { moneySchema } from './money';

describe('moneySchema', () => {
  it.each(['0', '100', '100.00', '12.23', '12.5'])('accepts %s', (value) => {
    expect(moneySchema.safeParse(value).success).toBe(true);
  });

  it.each(['12.234', '-1.00', '1,000.00', '12.', '.50', 'abc', ''])('rejects %s', (value) => {
    expect(moneySchema.safeParse(value).success).toBe(false);
  });
});
