import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CbeReceipts, parseCbeReceipt } from './cbe';

const text = readFileSync(
  new URL('../../../test/fixtures/cbe-receipt.txt', import.meta.url),
  'utf8',
);

const claim = {
  txRef: 'FT26189X24XP',
  amount: '20000.00',
  account: { accountName: 'Selam Shoes', accountNumber: '1000123456789' },
};

describe('parseCbeReceipt', () => {
  it("reads the reference, transferred amount, and the receiver's name and account", () => {
    expect(parseCbeReceipt(text)).toEqual({
      txRef: 'FT26189X24XP',
      amount: '20000.00',
      receiver: { name: 'SELAM TESFAYE ALEMU', account: '1****6789' },
      completed: true,
      paidAt: '11/5/2026, 3:10:00 PM',
    });
  });

  it('reports text that is not a CBE receipt', () => {
    expect(parseCbeReceipt('Something else')).toBe('UNREADABLE');
    expect(parseCbeReceipt(text.replace('Transferred Amount', 'Amount'))).toBe('UNREADABLE');
  });
});

const lookup = [claim.txRef, claim.account.accountNumber] as const;

describe('CbeReceipts', () => {
  it("looks the receipt up by reference and the receiving account's last 8 digits", async () => {
    const urls: string[] = [];
    const client = new CbeReceipts((url) => {
      urls.push(url);
      return Promise.resolve(new Response('<html>Not found</html>'));
    });
    expect(await client.read(claim.txRef, claim.account.accountNumber)).toBe('NOT_FOUND');
    expect(urls).toEqual(['https://apps.cbe.com.et:100/?id=FT26189X24XP23456789']);
  });

  it('finds nothing without the receiving account', async () => {
    const unused = new CbeReceipts(() => Promise.reject(new Error('not called')));
    expect(await unused.read(claim.txRef, null)).toBe('NOT_FOUND');
  });

  it('reports a 404 as not found and other failures as unavailable', async () => {
    const status = (code: number) => () => Promise.resolve(new Response('', { status: code }));
    expect(await new CbeReceipts(status(404)).read(...lookup)).toBe('NOT_FOUND');
    expect(await new CbeReceipts(status(502)).read(...lookup)).toBe('UNAVAILABLE');
    const refused = () => Promise.reject(new TypeError('fetch failed'));
    expect(await new CbeReceipts(refused).read(...lookup)).toBe('UNAVAILABLE');
  });

  it('is unavailable when a PDF cannot be read', async () => {
    const broken = () => Promise.resolve(new Response('%PDF-1.4 broken'));
    expect(await new CbeReceipts(broken).read(...lookup)).toBe('UNAVAILABLE');
  });
});
