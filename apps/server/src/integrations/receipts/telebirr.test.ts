import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BankReceipts } from './bank-receipts';
import { parseTelebirrReceipt, TelebirrReceipts } from './telebirr';

const page = readFileSync(
  new URL('../../../test/fixtures/telebirr-receipt.html', import.meta.url),
  'utf8',
);
const notFound = '<html><body><div>This request is not correct</div></body></html>';

const claim = {
  txRef: 'dg92ot8yde',
  amount: '4500.00',
  account: { accountName: 'Selam Tesfaye', accountNumber: '0911234567' },
};

const serving =
  (body: string, status = 200) =>
  () =>
    Promise.resolve(new Response(body, { status }));

describe('parseTelebirrReceipt', () => {
  it('reads the reference, settled amount, receiver, and status', () => {
    expect(parseTelebirrReceipt(page)).toEqual({
      txRef: 'DG92OT8YDE',
      amount: '4500',
      receiver: { name: 'SELAM TESFAYE ALEMU', account: '2519****4567' },
      completed: true,
      paidAt: '05-11-2026 15:10:00',
    });
  });

  it('recognises the page for an unknown transaction', () => {
    expect(parseTelebirrReceipt(notFound)).toBe('NOT_FOUND');
  });

  it('reports a page it cannot read', () => {
    expect(parseTelebirrReceipt('<html><title>Maintenance</title></html>')).toBe('UNREADABLE');
    expect(parseTelebirrReceipt(page.replace('Invoice No.', 'Number'))).toBe('UNREADABLE');
  });
});

describe('TelebirrReceipts', () => {
  it('reads the page of a transaction number', async () => {
    const urls: string[] = [];
    const client = new TelebirrReceipts((url) => {
      urls.push(url);
      return Promise.resolve(new Response(page));
    });
    expect(await client.read('dg92ot8yde')).toMatchObject({ txRef: 'DG92OT8YDE', amount: '4500' });
    expect(urls).toEqual(['https://transactioninfo.ethiotelecom.et/receipt/DG92OT8YDE']);
  });

  it('confirms a matching claim and finds a mismatch in the amount, receiver, or status', async () => {
    const bank = (body: string) =>
      new BankReceipts({ telebirr: new TelebirrReceipts(serving(body)) });
    expect(await bank(page).check('telebirr', claim)).toBe('CONFIRMED');
    expect(await bank(page).check('telebirr', { ...claim, amount: '5400.00' })).toBe('MISMATCH');
    const otherAccount = { accountName: 'Selam Tesfaye', accountNumber: '0911239999' };
    expect(await bank(page).check('telebirr', { ...claim, account: otherAccount })).toBe(
      'MISMATCH',
    );
    const failed = page.replace('>Completed<', '>Failed<');
    expect(await bank(failed).check('telebirr', claim)).toBe('MISMATCH');
  });

  it('reports an unknown transaction, without a lookup for an impossible reference', async () => {
    expect(await new TelebirrReceipts(serving(notFound)).read('DG92OT8YDE')).toBe('NOT_FOUND');
    const unused = new TelebirrReceipts(() => Promise.reject(new Error('not called')));
    expect(await unused.read('FT26189X24XP')).toBe('NOT_FOUND');
  });

  it('is unavailable after a timeout, an error status, or an unreadable page', async () => {
    const timeout = () => Promise.reject(new DOMException('timed out', 'TimeoutError'));
    expect(await new TelebirrReceipts(timeout).read('DG92OT8YDE')).toBe('UNAVAILABLE');
    expect(await new TelebirrReceipts(serving('', 503)).read('DG92OT8YDE')).toBe('UNAVAILABLE');
    expect(await new TelebirrReceipts(serving('<html></html>')).read('DG92OT8YDE')).toBe(
      'UNAVAILABLE',
    );
  });
});
