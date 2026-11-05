import type { QueryRows } from '../../../modules/reporting/reporting.domain';
import { addisDateTime } from '../../../shared/time';
import { numbersIn, unverifiedPrices } from '../sales/reply-prices.domain';

const weekday = new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'UTC' });

/** The first line of each owner turn, so the model can resolve "tomorrow" and "this weekend". */
export function todayLine(now: Date): string {
  const [day = '', time = ''] = addisDateTime(now).split(' ');
  // The date is the Addis calendar day, so its weekday at UTC midnight is the Addis weekday.
  const dayName = weekday.format(new Date(`${day}T00:00:00Z`));
  return `[Today in Addis Ababa: ${dayName} ${day}, ${time}]`;
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
