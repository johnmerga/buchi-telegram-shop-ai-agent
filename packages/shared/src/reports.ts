import { z } from 'zod';
import { moneySchema } from './money';

/** The reports that the cron service sends every day and that **Run now** sends at once. */
const dailyReportNames = ['evening-summary', 'morning-brief'] as const;
export const dailyReportNameSchema = z.enum(dailyReportNames);
export type DailyReportName = z.infer<typeof dailyReportNameSchema>;

/** A Google spreadsheet ID, the part of its address between `/d/` and `/edit`. */
const spreadsheetIdSchema = z
  .string()
  .trim()
  .regex(
    /^[A-Za-z0-9_-]{20,100}$/,
    'Paste the ID from the sheet’s address, between /d/ and /edit.',
  );

/** `null` disconnects the shop's spreadsheet. */
export const ledgerConnectSchema = z.object({ spreadsheetId: spreadsheetIdSchema.nullable() });
export type LedgerConnectInput = z.infer<typeof ledgerConnectSchema>;

/**
 * The shop's Google Sheets ledger. `serviceAccountEmail` is who the owner shares the sheet with,
 * and is null when the server has no Google credentials, so rows wait in the queue.
 */
export const ledgerSettingsSchema = z.object({
  spreadsheetId: z.string().nullable(),
  serviceAccountEmail: z.string().nullable(),
  pending: z.number().int().min(0),
  lastSentAt: z.iso.datetime().nullable(),
  lastError: z.string().nullable(),
});
export type LedgerSettings = z.infer<typeof ledgerSettingsSchema>;

/** A count out of a total. A total of zero means there was nothing to measure yet. */
const rateSchema = z.object({
  count: z.number().int().min(0),
  total: z.number().int().min(0),
});
export type Rate = z.infer<typeof rateSchema>;

/** How a channel post sold: Buy taps, and paid orders of its product since it was posted. */
export const postResultSchema = z.object({
  postId: z.uuid(),
  productTitle: z.string(),
  postedAt: z.iso.datetime(),
  taps: z.number().int().min(0),
  paidOrders: z.number().int().min(0),
});
export type PostResult = z.infer<typeof postResultSchema>;

/** The design doc's success metrics over the last `days` days, where Buchi records the data. */
export const insightsSchema = z.object({
  days: z.number().int().positive(),
  /** Paid orders whose payment Buchi approved without the owner, out of all paid orders. */
  autoApprovedPayments: rateSchema,
  fraudBlocked: z.object({ count: z.number().int().min(0), amount: moneySchema }),
  /** Far-area quotes held by a driver within 10 minutes, out of the quotes offered to drivers. */
  farQuotesDriverFound: rateSchema,
  delivery: z.object({
    trips: z.number().int().min(0),
    cost: moneySchema,
    saverSavings: moneySchema,
  }),
  guard: z.object({
    accepted: z.number().int().min(0),
    rejected: z.number().int().min(0),
    needsOwner: z.number().int().min(0),
  }),
  posts: z.array(postResultSchema),
});
export type Insights = z.infer<typeof insightsSchema>;
