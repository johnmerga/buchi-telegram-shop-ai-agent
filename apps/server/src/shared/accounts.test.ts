import { describe, expect, it } from 'vitest';
import { receiverMatches } from './accounts';

const telebirr = { accountName: 'Selam Tesfaye', accountNumber: '0911234567' };

describe('receiverMatches', () => {
  it('matches a masked number with the country code', () => {
    expect(receiverMatches({ name: null, account: '2519****4567' }, telebirr)).toBe(true);
    expect(receiverMatches({ name: null, account: '+251 911 234 567' }, telebirr)).toBe(true);
  });

  it('refuses a number whose visible digits differ', () => {
    expect(receiverMatches({ name: 'Selam Tesfaye', account: '2519****4568' }, telebirr)).toBe(
      false,
    );
  });

  it('falls back to the name when too few digits are visible', () => {
    expect(receiverMatches({ name: 'SELAM TESFAYE ALEMU', account: '****67' }, telebirr)).toBe(
      true,
    );
  });

  it('needs every word of the shorter name, and one word only matches one word', () => {
    expect(receiverMatches({ name: 'Selam Alemu', account: null }, telebirr)).toBe(false);
    const single = { accountName: 'Selam', accountNumber: '0911234567' };
    expect(receiverMatches({ name: 'Selam Tesfaye', account: null }, single)).toBe(false);
    expect(receiverMatches({ name: 'SELAM', account: null }, single)).toBe(true);
  });
});
