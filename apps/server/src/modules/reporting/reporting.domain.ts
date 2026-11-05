import { addisDay } from '../../shared/time';

type Cell = string | number | boolean | null;

/** Query rows as plain JSON values, which the model and the chart can read. */
export interface QueryRows {
  columns: string[];
  rows: Record<string, Cell>[];
}

const DAY_MS = 24 * 60 * 60_000;

/** The Monday of the week that `now` falls in, in Addis Ababa, as YYYY-MM-DD. */
export function weekOf(now: Date): string {
  const today = addisDay(now);
  // The day's UTC weekday is its Addis weekday, because `day` is the Addis calendar date.
  const daysSinceMonday = (new Date(`${today.day}T00:00:00Z`).getUTCDay() + 6) % 7;
  return addisDay(new Date(today.start.getTime() - daysSinceMonday * DAY_MS)).day;
}

/** The Chart.js configuration that QuickChart renders. */
export interface ChartConfig {
  type: 'bar' | 'line';
  data: { labels: string[]; datasets: { label: string; data: number[] }[] };
  options: { plugins: { title: { display: true; text: string }; legend: { display: boolean } } };
}

const MAX_SERIES = 3;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;

/**
 * A chart when the result is a series: at least two rows, a label in the first column, and a
 * number in each row of at least one other column. Dates make a line, anything else bars.
 */
export function seriesChart(result: QueryRows, title: string): ChartConfig | undefined {
  const [labelColumn, ...others] = result.columns;
  if (labelColumn === undefined || result.rows.length < 2) return undefined;
  const numeric = others
    .filter((column) => result.rows.every((row) => numberOf(row[column]) !== undefined))
    .slice(0, MAX_SERIES);
  if (numeric.length === 0) return undefined;
  const labels = result.rows.map((row) => labelOf(row[labelColumn]));
  return {
    type: labels.every((label) => ISO_DATE.test(label)) ? 'line' : 'bar',
    data: {
      labels: labels.map((label) => (ISO_DATE.test(label) ? label.slice(0, 10) : label)),
      datasets: numeric.map((column) => ({
        label: column,
        data: result.rows.map((row) => numberOf(row[column]) ?? 0),
      })),
    },
    options: {
      plugins: {
        title: { display: true, text: title },
        legend: { display: numeric.length > 1 },
      },
    },
  };
}

/** Postgres sends numerics as strings, such as "3500.00". */
function numberOf(cell: Cell | undefined): number | undefined {
  if (typeof cell === 'number') return cell;
  if (typeof cell !== 'string' || !/^-?\d+(\.\d+)?$/.test(cell)) return undefined;
  return Number(cell);
}

function labelOf(cell: Cell | undefined): string {
  return cell === null || cell === undefined ? '—' : String(cell);
}
