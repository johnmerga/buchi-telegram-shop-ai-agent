import { describe, expect, it } from 'vitest';
import { receiptLinkIn } from './receipt-links.domain';

describe('receiptLinkIn', () => {
  it('reads the transaction number from a Telebirr receipt link', () => {
    expect(
      receiptLinkIn('paid! https://transactioninfo.ethiotelecom.et/receipt/QX41ZB7KM2 thanks'),
    ).toEqual({ kind: 'telebirr', txRef: 'QX41ZB7KM2' });
  });

  it('ignores a Telebirr link whose number is not in the Telebirr format', () => {
    expect(receiptLinkIn('https://transactioninfo.ethiotelecom.et/receipt/ABC')).toBeUndefined();
  });

  it("reads the reference and the account's last 8 digits from a CBE receipt PDF link", () => {
    expect(receiptLinkIn('https://apps.cbe.com.et:100/?id=FT26310AB12C87654321')).toEqual({
      kind: 'cbe',
      txRef: 'FT26310AB12C',
      accountDigits: '87654321',
    });
  });

  it('recognises a CBE app receipt link, which only a screenshot can replace', () => {
    expect(receiptLinkIn('https://mbreciept.cbe.com.et/v2-abcDEF123_xyz')).toEqual({
      kind: 'cbe_app',
    });
  });

  it('reads a CBE reference written on its own', () => {
    expect(receiptLinkIn('my ref is ft26310ab12c')).toEqual({
      kind: 'cbe',
      txRef: 'FT26310AB12C',
      accountDigits: null,
    });
  });

  it('finds nothing in an ordinary message or an impossible reference', () => {
    expect(receiptLinkIn('Is the black one in size 42?')).toBeUndefined();
    expect(receiptLinkIn('FT26400AB12C')).toBeUndefined();
    expect(receiptLinkIn('XFT26310AB12C')).toBeUndefined();
  });
});
