import { Money, type PaymentAccount } from '@buchi/shared';
import { describe, expect, it } from 'vitest';
import {
  amountDue,
  checkAmount,
  checkReference,
  checkTime,
  isSupported,
  matchingAccount,
  readReceipt,
  type SupportedReceipt,
} from './payments.domain';
import type { ReceiptExtraction } from './payments.schemas';

const sure = <T>(value: T) => ({ value, confidence: 0.95 });

const extraction: ReceiptExtraction = {
  provider: sure('telebirr'),
  transactionRef: sure('dg92ot8yde'),
  amount: sure('4500.00'),
  receiverName: sure('SELAM TESFAYE ALEMU'),
  receiverAccount: sure('2519****4567'),
  payerName: sure('Hana Bekele'),
  payerAccount: sure('2519****1111'),
  paidAt: sure('2026-11-05T15:10:00'),
};

const accounts: PaymentAccount[] = [
  { provider: 'telebirr', accountName: 'Selam Tesfaye', accountNumber: '0911234567' },
  { provider: 'cbe_bank', accountName: 'Selam Shoes', accountNumber: '1000123456789' },
];

function receipt(overrides: Partial<SupportedReceipt> = {}): SupportedReceipt {
  return {
    provider: 'telebirr',
    txRef: 'DG92OT8YDE',
    amount: Money.of('4500'),
    receiver: { name: 'SELAM TESFAYE', account: '2519****4567' },
    paidAt: new Date('2026-11-05T12:10:00Z'),
    ...overrides,
  };
}

describe('R1: a readable payment receipt', () => {
  it('reads the receipt, with the time in Addis Ababa and the reference in capitals', () => {
    expect(readReceipt(extraction, 0.9)).toEqual({
      provider: 'telebirr',
      txRef: 'DG92OT8YDE',
      amount: Money.of('4500'),
      receiver: { name: 'SELAM TESFAYE ALEMU', account: '2519****4567' },
      paidAt: new Date('2026-11-05T12:10:00Z'),
    });
  });

  it('uses the fields alone when the classifier was unavailable', () => {
    expect(readReceipt(extraction, null)).toBeDefined();
  });

  it('fails when the image is a receipt with confidence below 0.7', () => {
    expect(readReceipt(extraction, 0.6)).toBeUndefined();
  });

  it('fails when a needed field is unsure or missing', () => {
    expect(readReceipt({ ...extraction, amount: { value: '4500', confidence: 0.5 } }, 0.9)).toBe(
      undefined,
    );
    expect(readReceipt({ ...extraction, transactionRef: sure(null) }, 0.9)).toBeUndefined();
  });

  it('fails when neither the receiver name nor the account can be read', () => {
    const noReceiver = { ...extraction, receiverName: sure(null), receiverAccount: sure(null) };
    expect(readReceipt(noReceiver, 0.9)).toBeUndefined();
  });

  it('fails when the time is not a real date', () => {
    expect(readReceipt({ ...extraction, paidAt: sure('2026-13-45T10:00') }, 0.9)).toBeUndefined();
  });
});

describe('R2: a supported provider', () => {
  it('accepts Telebirr, CBE Birr, and CBE banking', () => {
    expect(isSupported(receipt({ provider: 'cbe_birr' }))).toBe(true);
  });

  it('refuses any other provider', () => {
    expect(isSupported({ ...receipt(), provider: 'other' })).toBe(false);
  });
});

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

  it('fails when the provider has no account in the shop', () => {
    expect(matchingAccount(receipt({ provider: 'cbe_birr' }), accounts)).toBeUndefined();
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
