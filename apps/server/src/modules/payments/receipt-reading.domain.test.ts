import { Money } from '@buchi/shared';
import { describe, expect, it } from 'vitest';
import type { ReceiptExtraction } from './payments.schemas';
import { decideUnread, interpretReceipt, readBankPage } from './receipt-reading.domain';

const sure = (value: string | null) => ({ value, confidence: 0.95 });
const none = sure(null);

/** A CBE web receipt, copied as printed. All values are made up. */
const cbeWeb: ReceiptExtraction = {
  layout: { value: 'cbe_web', confidence: 0.95 },
  transactionRef: sure('FT26186AB12C'),
  amount: sure('1000.00 ETB'),
  serviceCharge: sure('0.53 ETB'),
  vat: sure('0.08 ETB'),
  totalAmount: sure('1000.61 ETB'),
  paidAt: sure('Jul 5, 2026, 11:17 AM'),
  receiverName: sure('Meron Alemu Kebede'),
  receiverAccount: sure('1****4321'),
  payerName: sure('Dawit Hailu'),
  payerAccount: sure('1****8765'),
  status: sure('COMPLETED'),
};

/** A Telebirr app screen, which prints the receiver's first name only and no total. */
const telebirrApp: ReceiptExtraction = {
  ...cbeWeb,
  layout: { value: 'telebirr_app', confidence: 0.9 },
  transactionRef: sure('QX41ZB7KM2'),
  amount: sure('-850.00 ETB'),
  serviceCharge: sure('-2.00 ETB'),
  vat: none,
  totalAmount: none,
  paidAt: sure('2026/06/11 11:20:04'),
  receiverName: sure('Meron'),
  receiverAccount: none,
  payerName: none,
  payerAccount: none,
  status: sure('Completed'),
};

describe('interpretReceipt', () => {
  it('reads a CBE web receipt in its own formats, with the time in Addis Ababa', () => {
    expect(interpretReceipt(cbeWeb, 0.9)).toEqual({
      status: 'read',
      receipt: {
        provider: 'cbe_bank',
        txRef: 'FT26186AB12C',
        amount: Money.of('1000'),
        receiver: { name: 'Meron Alemu Kebede', account: '1****4321' },
        receiverFirstNameOnly: false,
        paidAt: new Date('2026-07-05T08:17:00Z'),
      },
    });
  });

  it('reads a Telebirr app screen as year/day/month and marks its first-name receiver', () => {
    expect(interpretReceipt(telebirrApp, null)).toMatchObject({
      status: 'read',
      receipt: {
        provider: 'telebirr',
        amount: Money.of('850'),
        receiverFirstNameOnly: true,
        paidAt: new Date('2026-11-06T08:20:04Z'),
      },
    });
  });

  it('asks again when the image or the layout is unsure', () => {
    expect(interpretReceipt(cbeWeb, 0.6)).toEqual({ status: 'unreadable' });
    const unsure = { ...cbeWeb, layout: { value: 'cbe_web' as const, confidence: 0.5 } };
    expect(interpretReceipt(unsure, 0.9)).toEqual({ status: 'unreadable' });
  });

  it('asks again when a needed field is missing or unsure', () => {
    expect(interpretReceipt({ ...cbeWeb, amount: none }, 0.9)).toEqual({ status: 'unreadable' });
    const unsureRef = { ...cbeWeb, transactionRef: { value: 'FT26186AB12C', confidence: 0.4 } };
    expect(interpretReceipt(unsureRef, 0.9)).toEqual({ status: 'unreadable' });
    const noReceiver = { ...cbeWeb, receiverName: none, receiverAccount: sure('') };
    expect(interpretReceipt(noReceiver, 0.9)).toEqual({ status: 'unreadable' });
  });

  it('sends an unknown layout to the owner', () => {
    const unknown = { ...cbeWeb, layout: { value: 'unknown' as const, confidence: 0.99 } };
    expect(interpretReceipt(unknown, 0.9)).toEqual({ status: 'unknown_layout' });
  });

  it('sends a confident field in the wrong format to the owner', () => {
    const otherFormat = { ...cbeWeb, paidAt: sure('2026-07-05 11:17') };
    expect(interpretReceipt(otherFormat, 0.9)).toEqual({
      status: 'implausible',
      reason: 'unparseable',
    });
    const badRef = { ...telebirrApp, transactionRef: sure('QX41ZB7') };
    expect(interpretReceipt(badRef, 0.9)).toMatchObject({ reason: 'unparseable' });
    const badTotal = { ...cbeWeb, totalAmount: sure('about 1000') };
    expect(interpretReceipt(badTotal, 0.9)).toMatchObject({ reason: 'unparseable' });
  });

  it('sends a transaction that did not complete to the owner', () => {
    expect(interpretReceipt({ ...cbeWeb, status: sure('Pending') }, 0.9)).toEqual({
      status: 'implausible',
      reason: 'not_completed',
    });
  });

  it('sends a CBE reference from another day than the printed date to the owner', () => {
    const otherDay = { ...cbeWeb, transactionRef: sure('FT26150AB12C') };
    expect(interpretReceipt(otherDay, 0.9)).toEqual({
      status: 'implausible',
      reason: 'reference_date',
    });
  });

  it('sends an amount that does not fit the printed total to the owner', () => {
    expect(interpretReceipt({ ...cbeWeb, amount: sure('1,500.00 ETB') }, 0.9)).toEqual({
      status: 'implausible',
      reason: 'amount_total',
    });
  });
});

describe('readBankPage', () => {
  const page = {
    txRef: 'qx41zb7km2',
    amount: '850',
    receiver: { name: 'MERON ALEMU KEBEDE', account: '2519****4321' },
    completed: true,
    paidAt: '06-11-2026 11:20:04',
  };

  it("reads the provider's page in that page's date format", () => {
    expect(readBankPage('telebirr', page)).toEqual({
      status: 'read',
      receipt: {
        provider: 'telebirr',
        txRef: 'QX41ZB7KM2',
        amount: Money.of('850'),
        receiver: page.receiver,
        receiverFirstNameOnly: false,
        paidAt: new Date('2026-11-06T08:20:04Z'),
      },
    });
    const cbe = { ...page, txRef: 'FT26310AB12C', paidAt: '11/6/2026, 5:06:00 PM' };
    expect(readBankPage('cbe_bank', cbe)).toMatchObject({
      receipt: { paidAt: new Date('2026-11-06T14:06:00Z') },
    });
  });

  it('sends a page without a completed transaction or a readable date to the owner', () => {
    expect(readBankPage('telebirr', { ...page, completed: false })).toEqual({
      status: 'implausible',
      reason: 'not_completed',
    });
    expect(readBankPage('telebirr', { ...page, paidAt: null })).toEqual({
      status: 'implausible',
      reason: 'unparseable',
    });
  });
});

describe('decideUnread', () => {
  it('records R1 as failed and asks again for an unreadable receipt', () => {
    expect(decideUnread({ status: 'unreadable' }, 0)).toEqual({
      rules: { r1: 'fail' },
      decision: { outcome: 'ask_clearer' },
    });
  });

  it('records R2 as failed for an unknown layout', () => {
    expect(decideUnread({ status: 'unknown_layout' }, 0)).toEqual({
      rules: { r1: 'pass', r2: 'fail' },
      decision: { outcome: 'review', reason: 'unknown_layout' },
    });
  });

  it('runs no rule on an implausible receipt', () => {
    expect(decideUnread({ status: 'implausible', reason: 'amount_total' }, 0)).toEqual({
      rules: null,
      decision: { outcome: 'review', reason: 'amount_total' },
    });
  });
});
