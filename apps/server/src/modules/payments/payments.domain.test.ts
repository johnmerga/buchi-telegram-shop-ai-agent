import { Money, type PaymentAccount } from '@buchi/shared';
import { describe, expect, it } from 'vitest';
import {
  amountDue,
  checkAmount,
  checkReference,
  checkTime,
  matchingAccount,
} from './payments.domain';
import type { ReadReceipt } from './receipt-reading.domain';

const accounts: PaymentAccount[] = [
  { provider: 'telebirr', accountName: 'Selam Tesfaye', accountNumber: '0911234567' },
  { provider: 'cbe_bank', accountName: 'Selam Shoes', accountNumber: '1000123456789' },
];

function receipt(overrides: Partial<ReadReceipt> = {}): ReadReceipt {
  return {
    provider: 'telebirr',
    txRef: 'DG92OT8YDE',
    amount: Money.of('4500'),
    receiver: { name: 'SELAM TESFAYE', account: '2519****4567' },
    receiverFirstNameOnly: false,
    paidAt: new Date('2026-11-05T12:10:00Z'),
    ...overrides,
  };
}

describe('R3: the amount due', () => {
  it('passes the exact amount', () => {
    expect(checkAmount(Money.of('4500'), Money.of('4500.00'))).toBe('exact');
  });

  it('finds an underpayment and an overpayment', () => {
    expect(checkAmount(Money.of('4000'), Money.of('4500'))).toBe('underpaid');
    expect(checkAmount(Money.of('5000'), Money.of('4500'))).toBe('overpaid');
  });

  it('subtracts earlier partial payments once each, but not a resent one', () => {
    const partials = [
      { txRef: 'AAAA111111', amount: Money.of('1000') },
      { txRef: 'AAAA111111', amount: Money.of('1000') },
      { txRef: 'BBBB222222', amount: Money.of('500') },
    ];
    expect(amountDue(Money.of('4500'), partials, 'CCCC333333').toString()).toBe('3000.00');
    expect(amountDue(Money.of('4500'), partials, 'BBBB222222').toString()).toBe('3500.00');
  });
});

describe("R4: the shop's account", () => {
  it('matches the account number with the country code and masked digits', () => {
    expect(matchingAccount(receipt(), accounts)).toEqual(accounts[0]);
  });

  it('matches the name when the number is not shown', () => {
    const byName = receipt({ receiver: { name: 'SELAM TESFAYE ALEMU', account: null } });
    expect(matchingAccount(byName, accounts)).toEqual(accounts[0]);
  });

  it('fails for another account, even with the same name', () => {
    const other = receipt({ receiver: { name: 'Selam Tesfaye', account: '2519****9999' } });
    expect(matchingAccount(other, accounts)).toBeUndefined();
  });

  it("matches only the account holder's first name when the receipt shows no more", () => {
    const firstName = { receiverFirstNameOnly: true, receiver: { name: 'Selam', account: null } };
    expect(matchingAccount(receipt(firstName), accounts)).toEqual(accounts[0]);
    const other = { ...firstName, receiver: { name: 'Tesfaye', account: null } };
    expect(matchingAccount(receipt(other), accounts)).toBeUndefined();
  });

  it('fails when the provider has no account in the shop', () => {
    expect(matchingAccount(receipt(), accounts.slice(1))).toBeUndefined();
  });
});

describe('R5: paid after the order', () => {
  const ordered = new Date('2026-11-05T12:00:00Z');

  it('passes a payment after the order, or up to five minutes before it', () => {
    expect(checkTime(new Date('2026-11-05T12:30:00Z'), ordered)).toBe('pass');
    expect(checkTime(new Date('2026-11-05T11:55:00Z'), ordered)).toBe('pass');
  });

  it('fails an older payment', () => {
    expect(checkTime(new Date('2026-11-05T11:54:59Z'), ordered)).toBe('fail');
  });
});

describe('R6: a reference for one order only', () => {
  it('passes when this order holds the reference, also for a resend', () => {
    expect(checkReference('order-1', 'order-1')).toBe('pass');
  });

  it('fails when another order holds it', () => {
    expect(checkReference('order-2', 'order-1')).toBe('fail');
  });
});
