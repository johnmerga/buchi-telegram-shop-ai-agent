import { describe, expect, it } from 'vitest';
import { isHighRisk, payerKeys } from './risk.domain';

const secret = 's'.repeat(32);

describe('payer keys', () => {
  it('hashes the Telegram user ID and the phone number without revealing them', () => {
    const keys = payerKeys(secret, { telegramUserId: 424242, phone: '+251911000000' });
    expect(keys).toHaveLength(2);
    expect(keys.join()).not.toContain('424242');
    expect(keys.join()).not.toContain('911000000');
  });

  it('gives the same phone key with or without the country code', () => {
    const [, international] = payerKeys(secret, { telegramUserId: 1, phone: '+251911000000' });
    const [, local] = payerKeys(secret, { telegramUserId: 2, phone: '0911000000' });
    expect(international).toBe(local);
  });

  it('gives different keys with another secret', () => {
    const payer = { telegramUserId: 1, phone: null };
    expect(payerKeys(secret, payer)).not.toEqual(payerKeys('t'.repeat(32), payer));
  });

  it('uses only the Telegram user ID without a phone number', () => {
    expect(payerKeys(secret, { telegramUserId: 1, phone: null })).toHaveLength(1);
  });
});

describe('high risk', () => {
  it('starts at signals from two shops', () => {
    expect(isHighRisk(1)).toBe(false);
    expect(isHighRisk(2)).toBe(true);
  });
});
