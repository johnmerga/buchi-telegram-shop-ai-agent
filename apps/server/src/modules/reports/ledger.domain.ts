import type { MoneyString, PaymentProvider } from '@buchi/shared';
import { addisDateTime } from '../../shared/time';
import type { EveningSummary } from './daily-reports.domain';

export type LedgerTab = 'Sales' | 'Daily';

/** Text, or a number that the spreadsheet can add up. */
export type LedgerCell = string | number;

/** A row for the shop's spreadsheet. `key` is its first cell, which no other row repeats. */
export interface LedgerRow {
  key: string;
  tab: LedgerTab;
  cells: LedgerCell[];
}

/** The first row of an empty tab, so the owner's sheet explains its own columns. */
export const ledgerHeaders: Record<LedgerTab, string[]> = {
  Sales: [
    'Buchi ID',
    'Paid at (Addis Ababa)',
    'Order',
    'Items',
    'Delivery fee',
    'Total',
    'Provider',
    'Transaction ref',
    'Bank verified',
  ],
  Daily: [
    'Buchi ID',
    'Day',
    'Orders',
    'Paid orders',
    'Revenue',
    'Delivery cost',
    'Saver savings',
    'Fraud blocked',
    'Fraud blocked (birr)',
    'Open reviews',
  ],
};

export interface Sale {
  orderId: string;
  orderReference: string;
  paidAt: Date;
  lines: { title: string; size: string; quantity: number }[];
  deliveryFee: MoneyString;
  total: MoneyString;
  /** Empty when the owner approved a payment that Buchi could not read. */
  payment: { provider: PaymentProvider | null; txRef: string | null; bankVerified: boolean };
}

/** Amounts go in as numbers, so the owner's sheet can add them up. */
const amount = (value: MoneyString) => Number(value);

export function saleRow(sale: Sale): LedgerRow {
  return {
    key: `sale-${sale.orderId}`,
    tab: 'Sales',
    cells: [
      `sale-${sale.orderId}`,
      addisDateTime(sale.paidAt),
      sale.orderReference,
      sale.lines
        .map((line) => `${String(line.quantity)} × ${line.title} (${line.size})`)
        .join(', '),
      amount(sale.deliveryFee),
      amount(sale.total),
      sale.payment.provider ?? '',
      sale.payment.txRef ?? '',
      sale.payment.bankVerified ? 'yes' : 'no',
    ],
  };
}

export function dailySummaryRow(summary: EveningSummary): LedgerRow {
  const key = `day-${summary.day}`;
  return {
    key,
    tab: 'Daily',
    cells: [
      key,
      summary.day,
      summary.ordersCreated,
      summary.ordersPaid,
      amount(summary.revenue),
      amount(summary.deliveryCost),
      amount(summary.saverSavings),
      summary.fraudBlocked,
      amount(summary.fraudBlockedAmount),
      summary.openReviews,
    ],
  };
}

const MINUTE_MS = 60_000;
/** Six hours: a sheet that stays broken is still retried four times a day. */
const MAX_RETRY_DELAY_MS = 6 * 60 * MINUTE_MS;

/** Exponential backoff from one minute: the delay before attempt number `attempt` + 1. */
export function retryDelayMs(attempt: number): number {
  return Math.min(MINUTE_MS * 2 ** Math.max(attempt - 1, 0), MAX_RETRY_DELAY_MS);
}

/**
 * The cells to append to a tab, given the keys already in its first column. Rows whose key is
 * there arrived on an earlier attempt whose answer was lost, so they are not appended again.
 */
export function cellsToAppend(
  tab: LedgerTab,
  rows: LedgerRow[],
  keysInSheet: ReadonlySet<string>,
): LedgerCell[][] {
  const missing = rows.filter((row) => !keysInSheet.has(row.key)).map((row) => row.cells);
  if (missing.length === 0) return [];
  return keysInSheet.size === 0 ? [ledgerHeaders[tab], ...missing] : missing;
}
