import { Money, type PaymentProvider } from '@buchi/shared';
import type { ReceiptLayout } from './payments.schemas';

export type KnownLayout = Exclude<ReceiptLayout, 'unknown'>;
/** The providers whose receipt layouts Buchi reads. CBE Birr has none yet. */
export type ReceiptProvider = Extract<PaymentProvider, 'telebirr' | 'cbe_bank'>;

/** Receipts print local time. Ethiopia has no daylight saving time, so the offset is fixed. */
const ADDIS_OFFSET_MS = 3 * 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
/** Telebirr's web receipt rounds its total to whole birr, so the parts can differ by less than one. */
const TOTAL_TOLERANCE = Money.of('1.00');

const providers: Record<KnownLayout, ReceiptProvider> = {
  telebirr_app: 'telebirr',
  telebirr_app_success: 'telebirr',
  telebirr_web: 'telebirr',
  cbe_app: 'cbe_bank',
  cbe_app_success: 'cbe_bank',
  cbe_web: 'cbe_bank',
  cbe_pdf: 'cbe_bank',
};

export function providerOf(layout: KnownLayout): ReceiptProvider {
  return providers[layout];
}

/**
 * Telebirr transaction numbers are ten capital letters and digits, such as "DK69RQOP3J". CBE
 * references are "FT", the year's last two digits, the day of the year, and five capital letters
 * and digits, such as "FT26310T638F".
 */
const referenceFormats: Record<ReceiptProvider, RegExp> = {
  telebirr: /^[A-Z0-9]{10}$/,
  cbe_bank: /^FT\d{2}(?:00[1-9]|0[1-9]\d|[12]\d\d|3[0-5]\d|36[0-6])[A-Z0-9]{5}$/,
};

/** A printed reference without spaces, or undefined when it is not in the provider's format. */
export function parseReference(provider: ReceiptProvider, printed: string): string | undefined {
  const reference = printed.replace(/\s+/g, '').toUpperCase();
  return referenceFormats[provider].test(reference) ? reference : undefined;
}

/**
 * CBE numbers a transfer by the day it posts. That is the payment's own day, or the next one for
 * a payment late in the evening, so any other day means the reference and the date disagree.
 */
export function cbeReferenceMatchesDate(reference: string, paidAt: Date): boolean {
  const year = 2000 + Number(reference.slice(2, 4));
  const day = Number(reference.slice(4, 7));
  const local = paidAt.getTime() + ADDIS_OFFSET_MS;
  return [local, local + DAY_MS].some((time) => {
    const date = dayOfYear(time);
    return date.year === year && date.day === day;
  });
}

function dayOfYear(time: number): { year: number; day: number } {
  const year = new Date(time).getUTCFullYear();
  return { year, day: Math.floor((time - Date.UTC(year, 0, 1)) / DAY_MS) + 1 };
}

/**
 * An amount as a receipt prints it, such as "-3,500.00 ETB", "-19.00 (ETB)", "20 Birr", or
 * "ETB7.20". App screens print the payer's debit with a minus sign, which says nothing about the
 * amount itself.
 */
export function parsePrintedAmount(printed: string): Money | undefined {
  const match =
    /^(?:ETB\s*)?-?\s*(\d{1,3}(?:,\d{3})+|\d+)(\.\d{1,2})?\s*(?:\(?(?:ETB|Birr|ብር)\)?)?$/i.exec(
      printed.trim(),
    );
  if (!match?.[1]) return undefined;
  return Money.of(`${match[1].replace(/,/g, '')}${match[2] ?? ''}`);
}

/** Whether the amount and its charges make up the printed total. A missing charge counts as zero. */
export function chargesAddUp(amount: Money, charges: Money[], total: Money): boolean {
  const paid = charges.reduce((sum, charge) => sum.add(charge), amount);
  const difference = paid.compare(total) >= 0 ? paid.subtract(total) : total.subtract(paid);
  return difference.compare(TOTAL_TOLERANCE) < 0;
}

/**
 * Detail screens and pages print "Completed", the Telebirr app's payment screen "Successful", and
 * the CBE app's "Success" or "Transaction Completed Successfully!".
 */
const COMPLETED_STATUSES = [
  'completed',
  'successful',
  'success',
  'transaction completed successfully',
];

export function isCompleted(status: string): boolean {
  return COMPLETED_STATUSES.includes(
    status
      .trim()
      .replace(/[.!]+$/, '')
      .toLowerCase(),
  );
}

interface LocalTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const TELEBIRR_APP_TIME = /^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** The CBE web page and the app's payment screen print "Nov 07, 2026 11:28 AM". */
function monthNameTime(printed: string): LocalTime | undefined {
  const m = /^([a-z]{3}) (\d{1,2}), (\d{4}),? (\d{1,2}):(\d{2}) ?([ap]m)$/i.exec(printed);
  return m ? local(m[3], monthOf(m[1]), m[2], twelveHour(m[4], m[6]), m[5], '0') : undefined;
}

/**
 * Each layout's own date format. The Telebirr app's "Transaction Detail" screen prints
 * year/day/month, such as "2026/06/11" for 6 November, but its screen right after a payment prints
 * year/month/day, such as "2026/11/07" for 7 November.
 */
const timeFormats: Record<KnownLayout, (printed: string) => LocalTime | undefined> = {
  telebirr_app: (printed) => {
    const m = TELEBIRR_APP_TIME.exec(printed);
    return m ? local(m[1], m[3], m[2], m[4], m[5], m[6]) : undefined;
  },
  telebirr_app_success: (printed) => {
    const m = TELEBIRR_APP_TIME.exec(printed);
    return m ? local(m[1], m[2], m[3], m[4], m[5], m[6]) : undefined;
  },
  telebirr_web: (printed) => {
    const m = /^(\d{2})-(\d{2})-(\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec(printed);
    return m ? local(m[3], m[2], m[1], m[4], m[5], m[6]) : undefined;
  },
  cbe_app: (printed) => {
    const m = /^(\d{1,2})-([a-z]{3})-(\d{2}) (\d{1,2}):(\d{2}) ?([ap]m)$/i.exec(printed);
    return m
      ? local(`20${m[3] ?? ''}`, monthOf(m[2]), m[1], twelveHour(m[4], m[6]), m[5], '0')
      : undefined;
  },
  cbe_app_success: monthNameTime,
  cbe_web: monthNameTime,
  cbe_pdf: (printed) => {
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4}),? (\d{1,2}):(\d{2})(?::(\d{2}))? ?([ap]m)$/i.exec(
      printed,
    );
    return m ? local(m[3], m[1], m[2], twelveHour(m[4], m[7]), m[5], m[6] ?? '0') : undefined;
  },
};

/** A printed date and time in the layout's format, as an instant, or undefined if invalid. */
export function parsePrintedTime(layout: KnownLayout, printed: string): Date | undefined {
  const time = timeFormats[layout](printed.trim().replace(/\s+/g, ' '));
  if (!time) return undefined;
  const { year, month, day, hour, minute, second } = time;
  const utc = Date.UTC(year, month - 1, day, hour, minute, second);
  const check = new Date(utc);
  // Date.UTC rolls 31 June over to 1 July, so a date that changed was not a real date.
  const valid =
    check.getUTCFullYear() === year &&
    check.getUTCMonth() === month - 1 &&
    check.getUTCDate() === day &&
    hour < 24 &&
    minute < 60 &&
    second < 60;
  return valid ? new Date(utc - ADDIS_OFFSET_MS) : undefined;
}

function local(...parts: (string | number | undefined)[]): LocalTime | undefined {
  const numbers = parts.map(Number);
  if (numbers.some((n) => !Number.isInteger(n))) return undefined;
  const [year = 0, month = 0, day = 0, hour = 0, minute = 0, second = 0] = numbers;
  return { year, month, day, hour, minute, second };
}

function monthOf(name: string | undefined): number | undefined {
  const index = MONTHS.indexOf(name?.toLowerCase() ?? '');
  return index < 0 ? undefined : index + 1;
}

/** "12:05 AM" is just after midnight and "12:05 PM" just after noon. */
function twelveHour(hour: string | undefined, half: string | undefined): number | undefined {
  const value = Number(hour);
  if (!Number.isInteger(value) || value < 1 || value > 12) return undefined;
  return (value % 12) + (half?.toLowerCase() === 'pm' ? 12 : 0);
}
