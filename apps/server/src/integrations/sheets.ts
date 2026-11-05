import { z } from 'zod';
import type { LedgerCell, LedgerTab } from '../modules/reports/ledger.domain';
import type { LedgerSheets } from '../modules/reports/ledger.service';

const API = 'https://sheets.googleapis.com/v4/spreadsheets';
const TIMEOUT_MS = 10_000;

/** An empty range comes back without `values`. */
const columnSchema = z.object({ values: z.array(z.array(z.string())).optional() });
const errorSchema = z.object({ error: z.object({ message: z.string() }) });

/** The Google Sheets API v4 over `fetch`: reading a tab's first column and appending rows. */
export class GoogleSheets implements LedgerSheets {
  constructor(
    private readonly accessToken: () => Promise<string>,
    private readonly fetch: typeof globalThis.fetch,
  ) {}

  async firstColumn(spreadsheetId: string, tab: LedgerTab): Promise<Set<string>> {
    const url = `${this.rangeUrl(spreadsheetId, `${tab}!A:A`)}?majorDimension=COLUMNS`;
    const body = await this.request(url, { method: 'GET' });
    return new Set(columnSchema.parse(body).values?.[0] ?? []);
  }

  /** `RAW` keeps a cell such as "=1+1" as text, so a product title can never run as a formula. */
  async append(spreadsheetId: string, tab: LedgerTab, rows: LedgerCell[][]): Promise<void> {
    const url = `${this.rangeUrl(spreadsheetId, `${tab}!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
    await this.request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ values: rows }),
    });
  }

  private rangeUrl(spreadsheetId: string, range: string): string {
    return `${API}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`;
  }

  private async request(url: string, init: RequestInit): Promise<unknown> {
    const headers = new Headers(init.headers);
    headers.set('authorization', `Bearer ${await this.accessToken()}`);
    const response = await this.fetch(url, {
      ...init,
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      // Google's message, such as "The caller does not have permission", tells the owner what to fix.
      const reason = errorSchema.safeParse(body);
      const detail = reason.success ? `: ${reason.data.error.message}` : '';
      throw new Error(`Google Sheets answered ${String(response.status)}${detail}`);
    }
    return body;
  }
}
