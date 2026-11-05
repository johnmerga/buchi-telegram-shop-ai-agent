import type { BankCheck } from '@buchi/shared';
import { PDFParse } from 'pdf-parse';
import type { FetchPage } from './fetch-page';
import {
  amountOf,
  bankReceiptSchema,
  compareReceipt,
  type ParsedPage,
  type ReceiptClaim,
  type ReceiptClient,
} from './receipt-check';

const RECEIPT_URL = 'https://apps.cbe.com.et:100/?id=';
/** CBE transfer references are "FT" and ten capital letters and digits, such as "FT26189X24XP". */
const TX_REF = /^FT[A-Z0-9]{10}$/;
/** The page finds a receipt by its reference followed by the receiving account's last 8 digits. */
const ACCOUNT_SUFFIX_DIGITS = 8;

/** The Commercial Bank of Ethiopia's public receipt PDF, looked up by reference and account. */
export class CbeReceipts implements ReceiptClient {
  constructor(private readonly fetchPage: FetchPage) {}

  async check(claim: ReceiptClaim): Promise<BankCheck> {
    const txRef = claim.txRef.toUpperCase();
    if (!TX_REF.test(txRef)) return 'NOT_FOUND';
    const suffix = claim.account.accountNumber.replace(/\D/g, '').slice(-ACCOUNT_SUFFIX_DIGITS);
    try {
      const response = await this.fetchPage(`${RECEIPT_URL}${txRef}${suffix}`);
      if (response.status === 404) return 'NOT_FOUND';
      if (!response.ok) return 'UNAVAILABLE';
      const bytes = new Uint8Array(await response.arrayBuffer());
      // The page answers an unknown reference with something other than a PDF.
      if (!isPdf(bytes)) return 'NOT_FOUND';
      const page = parseCbeReceipt(await pdfText(bytes));
      if (page === 'UNREADABLE') return 'UNAVAILABLE';
      return page === 'NOT_FOUND' ? 'NOT_FOUND' : compareReceipt(page, { ...claim, txRef });
    } catch {
      // Timeouts, certificate errors, and an unreachable host all mean no evidence either way.
      return 'UNAVAILABLE';
    }
  }
}

function isPdf(bytes: Uint8Array): boolean {
  return new TextDecoder().decode(bytes.subarray(0, 5)) === '%PDF-';
}

async function pdfText(bytes: Uint8Array): Promise<string> {
  const parser = new PDFParse({ data: bytes });
  try {
    return (await parser.getText()).text;
  } finally {
    await parser.destroy();
  }
}

/**
 * Reads the text of a CBE receipt PDF. The labels have no colons, and "Account" appears twice:
 * first for the payer, then for the receiver.
 */
export function parseCbeReceipt(text: string): ParsedPage {
  if (!text.includes('Commercial Bank of Ethiopia')) return 'UNREADABLE';
  const accounts = [...text.matchAll(/Account\s+([0-9*]{4,})/g)].map((match) => match[1]);
  const parsed = bankReceiptSchema.safeParse({
    txRef: /Reference No\.?\s*\(VAT Invoice No\)\s*([A-Z0-9]+)/i.exec(text)?.[1],
    amount: amountOf(/Transferred Amount\s*([\d,.]+\s*ETB)/i.exec(text)?.[1] ?? ''),
    receiver: {
      name: /Receiver[ \t]+(.+?)[ \t]*(?=\n|Account|$)/.exec(text)?.[1] ?? null,
      account: accounts[1] ?? null,
    },
    // CBE issues a receipt only for a completed transfer.
    completed: true,
  });
  return parsed.success ? parsed.data : 'UNREADABLE';
}
