import type { BankCheck } from '@buchi/shared';
import { load } from 'cheerio';
import type { FetchPage } from './fetch-page';
import {
  amountOf,
  bankReceiptSchema,
  compareReceipt,
  type ParsedPage,
  type ReceiptClaim,
  type ReceiptClient,
} from './receipt-check';

const RECEIPT_URL = 'https://transactioninfo.ethiotelecom.et/receipt/';
/** Telebirr transaction numbers are ten capital letters and digits, such as "DG92OT8YDE". */
const TX_REF = /^[A-Z0-9]{10}$/;

/** Ethio telecom's public Telebirr receipt page, looked up by transaction number. */
export class TelebirrReceipts implements ReceiptClient {
  constructor(private readonly fetchPage: FetchPage) {}

  async check(claim: ReceiptClaim): Promise<BankCheck> {
    const txRef = claim.txRef.toUpperCase();
    if (!TX_REF.test(txRef)) return 'NOT_FOUND';
    try {
      const response = await this.fetchPage(`${RECEIPT_URL}${txRef}`);
      if (!response.ok) return 'UNAVAILABLE';
      const page = parseTelebirrReceipt(await response.text());
      if (page === 'UNREADABLE') return 'UNAVAILABLE';
      return page === 'NOT_FOUND' ? 'NOT_FOUND' : compareReceipt(page, { ...claim, txRef });
    } catch {
      // Timeouts, blocked foreign IP addresses, and network errors all mean no evidence either way.
      return 'UNAVAILABLE';
    }
  }
}

/**
 * Reads the receipt page. Its labels are bilingual ("የከፋይ ስም/Payer Name") in one cell with the
 * value in the next, except the invoice number, date, and settled amount, which sit in a row
 * under a three-cell header row. The markup is malformed, so this reads the flat list of cells.
 */
export function parseTelebirrReceipt(html: string): ParsedPage {
  const $ = load(html);
  if ($('body').text().includes('This request is not correct')) return 'NOT_FOUND';
  if (!$('title').text().toLowerCase().includes('telebirr receipt')) return 'UNREADABLE';

  const cells = $('td')
    .filter((_, cell) => $(cell).find('td').length === 0)
    .map((_, cell) => $(cell).text().replace(/\s+/g, ' ').trim())
    .get();
  const indexOf = (label: string) =>
    cells.findIndex((cell) => cell.toLowerCase().endsWith(label.toLowerCase()));
  const after = (label: string, offset = 1) => {
    const index = indexOf(label);
    return index < 0 ? undefined : cells[index + offset];
  };

  // The invoice header row is "Invoice No.", "Payment date", "Settled Amount"; its values follow.
  const parsed = bankReceiptSchema.safeParse({
    txRef: after('/Invoice No.', 3),
    amount: amountOf(after('/Invoice No.', 5) ?? ''),
    receiver: {
      name: after('/Credited Party name') || null,
      account: after('/Credited party account no') || null,
    },
    completed: after('/transaction status')?.toLowerCase() === 'completed',
  });
  return parsed.success ? parsed.data : 'UNREADABLE';
}
