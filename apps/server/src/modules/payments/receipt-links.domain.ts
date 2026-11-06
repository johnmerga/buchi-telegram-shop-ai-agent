import { parseReference } from './receipt-layouts.domain';

/**
 * A receipt that a customer named in a text message. A CBE reference without the receiving
 * account's digits is looked up with the shop's own CBE accounts.
 */
export type ReceiptLink =
  | { kind: 'telebirr'; txRef: string }
  | { kind: 'cbe'; txRef: string; accountDigits: string | null }
  /** A CBE app receipt link, whose page loads from a private API that Buchi does not call. */
  | { kind: 'cbe_app' };

const TELEBIRR_URL = /transactioninfo\.ethiotelecom\.et\/receipt\/([A-Za-z0-9]+)/i;
/** The legacy PDF's ID is the reference followed by the receiving account's last 8 digits. */
const CBE_PDF_URL = /apps\.cbe\.com\.et(?::\d+)?\/?\?id=(FT[A-Za-z0-9]{10})(\d{8})(?![A-Za-z0-9])/i;
/** CBE spells its own host "mbreciept". */
const CBE_APP_URL = /mbrec(?:ie|ei)pt\.cbe\.com\.et\/v2-[\w-]+/i;
const CBE_REFERENCE = /(?<![A-Za-z0-9])FT\d{5}[A-Za-z0-9]{5}(?![A-Za-z0-9])/i;

/** The first receipt link or CBE reference in a message, read by code without the model. */
export function receiptLinkIn(text: string): ReceiptLink | undefined {
  const telebirr = TELEBIRR_URL.exec(text)?.[1];
  if (telebirr !== undefined) {
    const txRef = parseReference('telebirr', telebirr);
    return txRef === undefined ? undefined : { kind: 'telebirr', txRef };
  }
  const pdf = CBE_PDF_URL.exec(text);
  if (pdf) return cbe(pdf[1], pdf[2] ?? null);
  if (CBE_APP_URL.test(text)) return { kind: 'cbe_app' };
  const reference = CBE_REFERENCE.exec(text)?.[0];
  return reference === undefined ? undefined : cbe(reference, null);
}

function cbe(reference: string | undefined, accountDigits: string | null): ReceiptLink | undefined {
  const txRef = parseReference('cbe_bank', reference ?? '');
  return txRef === undefined ? undefined : { kind: 'cbe', txRef, accountDigits };
}
