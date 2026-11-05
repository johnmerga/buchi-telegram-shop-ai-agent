import type { QueryRows } from '../../../modules/insights/insights.domain';
import { numbersIn, unverifiedPrices } from '../sales/reply-prices.domain';

const addisNow = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Addis_Ababa',
  weekday: 'long',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** The first line of each owner turn, so the model can resolve "tomorrow" and "this weekend". */
export function todayLine(now: Date): string {
  const parts = Object.fromEntries(addisNow.formatToParts(now).map((p) => [p.type, p.value]));
  const { weekday = '', year = '', month = '', day = '', hour = '', minute = '' } = parts;
  return `[Today in Addis Ababa: ${weekday} ${year}-${month}-${day}, ${hour}:${minute}]`;
}

/**
 * Whether a reply names an amount that neither the owner, the context, nor a tool result gave.
 * The same check as the sales agent's, so the owner never reads a made-up figure.
 */
export function namesUnknownAmount(reply: string, trustedTexts: string[]): boolean {
  return unverifiedPrices(reply, trustedTexts.flatMap(numbersIn)).length > 0;
}

const SHOWN_ROWS = 15;

/** The rows as plain text, for when a reply cannot be trusted or the chart cannot be drawn. */
export function rowsText(result: QueryRows): string {
  if (result.rows.length === 0) return 'No rows matched.';
  const lines = result.rows
    .slice(0, SHOWN_ROWS)
    .map((row) => result.columns.map((column) => String(row[column] ?? '—')).join(' · '));
  const more =
    result.rows.length > SHOWN_ROWS
      ? [`… and ${String(result.rows.length - SHOWN_ROWS)} more`]
      : [];
  return [result.columns.join(' · '), ...lines, ...more].join('\n');
}
