import { Money } from '@buchi/shared';
import { describe, expect, it } from 'vitest';
import type { ReceiptExtraction } from './payments.schemas';
import {
  decideUnread,
  interpretReceipt,
  readBankPage,
  withReference,
} from './receipt-reading.domain';

const sure = (value: string | null) => ({ value, confidence: 0.95 });
const none = sure(null);

/** A CBE web receipt, copied as printed. All values are made up. */
const cbeWeb: ReceiptExtraction = {
  layout: { value: 'cbe_web', confidence: 0.95 },
  transactionRef: sure('FT26186AB12C'),
  amount: sure('1000.00 ETB'),
  serviceCharge: sure('0.53 ETB'),
  vat: sure('0.08 ETB'),
  otherCharge: none,
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

  it("reads the Telebirr app's payment screen as year/month/day with the fee in its amount", () => {
    const success = {
      ...telebirrApp,
      layout: { value: 'telebirr_app_success' as const, confidence: 0.9 },
      amount: sure('-19.00 (ETB)'),
      serviceCharge: none,
      paidAt: sure('2026/11/07 01:54:27'),
      receiverName: sure('MERON'),
      status: none,
    };
    expect(interpretReceipt(success, 0.9)).toMatchObject({
      status: 'read',
      receipt: {
        provider: 'telebirr',
        amount: Money.of('19'),
        receiverFirstNameOnly: true,
        paidAt: new Date('2026-11-06T22:54:27Z'),
      },
    });
    expect(interpretReceipt({ ...success, status: sure('Successful') }, 0.9)).toMatchObject({
      status: 'read',
    });
  });

  it("reads the CBE app's payment summary, counting the disaster recovery charge in the total", () => {
    const summary: ReceiptExtraction = {
      ...cbeWeb,
      layout: { value: 'cbe_app_success', confidence: 0.95 },
      transactionRef: sure('FT2631183Y49'),
      amount: sure('ETB 6.59'),
      serviceCharge: sure('ETB0.50'),
      vat: sure('ETB0.08'),
      otherCharge: sure('ETB0.03'),
      totalAmount: sure('ETB7.20'),
      paidAt: sure('Nov 07, 2026 11:28 AM'),
      receiverAccount: sure('ETB-4321'),
      status: sure('Transaction Completed Successfully!'),
    };
    expect(interpretReceipt(summary, 0.9)).toEqual({
      status: 'read',
      receipt: {
        provider: 'cbe_bank',
        txRef: 'FT2631183Y49',
        amount: Money.of('6.59'),
        receiver: { name: 'Meron Alemu Kebede', account: 'ETB-4321' },
        receiverFirstNameOnly: false,
        paidAt: new Date('2026-11-07T08:28:00Z'),
      },
    });
    const largerCharge = { ...summary, amount: sure('ETB 5.59'), otherCharge: sure('ETB 1.03') };
    expect(interpretReceipt(largerCharge, 0.9)).toMatchObject({ status: 'read' });
    const edited = { ...summary, amount: sure('ETB 16.59') };
    expect(interpretReceipt(edited, 0.9)).toEqual({
      status: 'implausible',
      reason: 'amount_total',
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
    const badTotal = { ...cbeWeb, totalAmount: sure('about 1000') };
    expect(interpretReceipt(badTotal, 0.9)).toMatchObject({ reason: 'unparseable' });
  });

  it('sends a transaction that did not complete to the owner', () => {
    expect(interpretReceipt({ ...cbeWeb, status: sure('Pending') }, 0.9)).toEqual({
      status: 'implausible',
      reason: 'not_completed',
    });
  });

  it('flags a reference alone that does not fit its format, to be read again', () => {
    const dropped = { ...cbeWeb, transactionRef: sure('FT2618600AB') };
    expect(interpretReceipt(dropped, 0.9)).toEqual({
      status: 'bad_reference',
      provider: 'cbe_bank',
      problem: 'unparseable',
    });
    const short = { ...telebirrApp, transactionRef: sure('QX41ZB7') };
    expect(interpretReceipt(short, 0.9)).toMatchObject({ provider: 'telebirr' });
  });

  it('takes a typed CBE reference from another day as the customer typed it', () => {
    const otherDay = { ...cbeWeb, transactionRef: sure('FT26150AB12C') };
    expect(interpretReceipt(otherDay, null, { referenceTyped: true })).toMatchObject({
      status: 'read',
      receipt: { txRef: 'FT26150AB12C' },
    });
  });

  it('flags a CBE reference from another day than the printed date, to be read again', () => {
    const otherDay = { ...cbeWeb, transactionRef: sure('FT26150AB12C') };
    expect(interpretReceipt(otherDay, 0.9)).toEqual({
      status: 'bad_reference',
      provider: 'cbe_bank',
      problem: 'reference_date',
    });
  });

  it('reads the receipt with a reference read again or typed', () => {
    const dropped = { ...cbeWeb, transactionRef: sure('FT2618600AB') };
    expect(interpretReceipt(withReference(dropped, 'ft26186 ab12c'), 0.9)).toMatchObject({
      status: 'read',
      receipt: { txRef: 'FT26186AB12C' },
    });
  });

  it('checks everything else before the reference', () => {
    const both = { ...cbeWeb, transactionRef: sure('FT2618'), amount: sure('1,500.00 ETB') };
    expect(interpretReceipt(both, 0.9)).toEqual({ status: 'implausible', reason: 'amount_total' });
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
  const asks = { unreadable: 0, reference: 0 };

  it('records R1 as failed and asks again for an unreadable receipt', () => {
    expect(decideUnread({ status: 'unreadable' }, asks)).toEqual({
      rules: { r1: 'fail' },
      decision: { outcome: 'ask_clearer' },
    });
  });

  it('records R2 as failed for an unknown layout', () => {
    expect(decideUnread({ status: 'unknown_layout' }, asks)).toEqual({
      rules: { r1: 'pass', r2: 'fail' },
      decision: { outcome: 'review', reason: 'unknown_layout' },
    });
  });

  it('runs no rule on an implausible receipt', () => {
    expect(decideUnread({ status: 'implausible', reason: 'amount_total' }, asks)).toEqual({
      rules: null,
      decision: { outcome: 'review', reason: 'amount_total' },
    });
  });

  it('asks the customer for the reference twice, then sends it to the owner', () => {
    const bad = {
      status: 'bad_reference',
      provider: 'cbe_bank',
      problem: 'reference_date',
    } as const;
    expect(decideUnread(bad, { unreadable: 0, reference: 1 }).decision).toEqual({
      outcome: 'ask_reference',
    });
    expect(decideUnread(bad, { unreadable: 0, reference: 2 }).decision).toEqual({
      outcome: 'review',
      reason: 'reference_date',
    });
  });
});
