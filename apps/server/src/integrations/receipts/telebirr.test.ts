import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
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
  it('confirms a page that matches the screenshot, looked up by its reference', async () => {
    const urls: string[] = [];
    const client = new TelebirrReceipts((url) => {
      urls.push(url);
      return Promise.resolve(new Response(page));
    });
    expect(await client.check(claim)).toBe('CONFIRMED');
    expect(urls).toEqual(['https://transactioninfo.ethiotelecom.et/receipt/DG92OT8YDE']);
  });

  it('finds a mismatch in the amount or the receiver', async () => {
    const client = new TelebirrReceipts(serving(page));
    expect(await client.check({ ...claim, amount: '5400.00' })).toBe('MISMATCH');
    const otherAccount = { accountName: 'Selam Tesfaye', accountNumber: '0911239999' };
    expect(await client.check({ ...claim, account: otherAccount })).toBe('MISMATCH');
  });

  it('finds a mismatch in a transaction that did not complete', async () => {
    const failed = page.replace('>Completed<', '>Failed<');
    expect(await new TelebirrReceipts(serving(failed)).check(claim)).toBe('MISMATCH');
  });

  it('reports an unknown transaction, without a lookup for an impossible reference', async () => {
    expect(await new TelebirrReceipts(serving(notFound)).check(claim)).toBe('NOT_FOUND');
    const unused = new TelebirrReceipts(() => Promise.reject(new Error('not called')));
    expect(await unused.check({ ...claim, txRef: 'FT26189X24XP' })).toBe('NOT_FOUND');
  });

  it('is unavailable after a timeout, an error status, or an unreadable page', async () => {
    const timeout = () => Promise.reject(new DOMException('timed out', 'TimeoutError'));
    expect(await new TelebirrReceipts(timeout).check(claim)).toBe('UNAVAILABLE');
    expect(await new TelebirrReceipts(serving('', 503)).check(claim)).toBe('UNAVAILABLE');
    expect(await new TelebirrReceipts(serving('<html></html>')).check(claim)).toBe('UNAVAILABLE');
  });
});
