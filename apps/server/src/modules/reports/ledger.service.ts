import type { LedgerSettings } from '@buchi/shared';
import type { Logger } from 'pino';
import type { Database } from '../../db/client';
import { withShop } from '../../db/with-shop';
import {
  cellsToAppend,
  retryDelayMs,
  type LedgerCell,
  type LedgerRow,
  type LedgerTab,
} from './ledger.domain';
import type { LedgerRepo, QueuedLedgerRow } from './ledger.repo';

/** The spreadsheet operations the ledger needs. Google Sheets is the only implementation. */
export interface LedgerSheets {
  firstColumn(spreadsheetId: string, tab: LedgerTab): Promise<Set<string>>;
  append(spreadsheetId: string, tab: LedgerTab, rows: LedgerCell[][]): Promise<void>;
}

/** Google Sheets with the service account that owners share their sheet with. */
export interface LedgerGoogle {
  sheets: LedgerSheets;
  serviceAccountEmail: string;
}

// A type alias, not an interface, so it fits the jobs' `Record<string, number>` summary type.
type FlushSummary = {
  ledgerSent: number;
  ledgerFailed: number;
};

/** Each tick sends at most this many rows per shop, which keeps it well inside the cron timeout. */
const BATCH_SIZE = 50;
/** An attempt that crashed is retried after this, which is longer than any one attempt takes. */
const LEASE_MS = 2 * 60_000;
const tabs: readonly LedgerTab[] = ['Sales', 'Daily'];

/**
 * The shop's sales ledger in Google Sheets. Rows wait in Postgres until Sheets takes them, so an
 * outage or missing credentials only delays them. Without Google credentials the queue is kept and
 * nothing is sent, so the rows arrive once the operator adds the credentials.
 */
export class LedgerService {
  constructor(
    private readonly db: Database,
    private readonly repo: LedgerRepo,
    private readonly google: LedgerGoogle | undefined,
    private readonly logger: Logger,
    private readonly now: () => Date,
  ) {}

  async settings(shopId: string): Promise<LedgerSettings> {
    const { spreadsheetId, state } = await withShop(this.db, shopId, async (tx) => ({
      spreadsheetId: await this.repo.spreadsheetId(tx),
      state: await this.repo.queueState(tx),
    }));
    return {
      spreadsheetId,
      serviceAccountEmail: this.google?.serviceAccountEmail ?? null,
      pending: state.pending,
      lastSentAt: state.lastSentAt?.toISOString() ?? null,
      lastError: state.lastError,
    };
  }

  async connect(shopId: string, spreadsheetId: string | null): Promise<void> {
    await withShop(this.db, shopId, (tx) =>
      spreadsheetId === null
        ? this.repo.removeSpreadsheet(tx)
        : this.repo.setSpreadsheet(tx, shopId, spreadsheetId),
    );
  }

  /** Queues a row only for a shop that keeps a ledger, and only once per key. */
  async enqueue(shopId: string, row: LedgerRow): Promise<void> {
    await withShop(this.db, shopId, async (tx) => {
      if ((await this.repo.spreadsheetId(tx)) !== null) {
        await this.repo.enqueue(tx, shopId, row, this.now());
      }
    });
  }

  /** Runs on every tick: sends due rows of every shop, and backs off a shop whose sheet fails. */
  async flush(): Promise<FlushSummary> {
    const summary: FlushSummary = { ledgerSent: 0, ledgerFailed: 0 };
    if (!this.google) return summary;
    const now = this.now();
    for (const shopId of await this.repo.dueShopIds(this.db, now)) {
      const { spreadsheetId, rows } = await withShop(this.db, shopId, async (tx) => ({
        spreadsheetId: await this.repo.spreadsheetId(tx),
        rows: await this.repo.claimDue(tx, now, new Date(now.getTime() + LEASE_MS), BATCH_SIZE),
      }));
      if (spreadsheetId === null) continue;
      for (const tab of tabs) {
        const inTab = rows.filter((row) => row.tab === tab);
        if (inTab.length === 0) continue;
        const sent = await this.send(this.google.sheets, shopId, spreadsheetId, tab, inTab);
        summary[sent ? 'ledgerSent' : 'ledgerFailed'] += inTab.length;
      }
    }
    return summary;
  }

  /**
   * Sheets has no idempotent append, and a timeout can hide an append that succeeded. So each
   * attempt first reads the keys in the tab's first column and appends only the missing rows.
   */
  private async send(
    sheets: LedgerSheets,
    shopId: string,
    spreadsheetId: string,
    tab: LedgerTab,
    rows: QueuedLedgerRow[],
  ): Promise<boolean> {
    try {
      const cells = cellsToAppend(tab, rows, await sheets.firstColumn(spreadsheetId, tab));
      if (cells.length > 0) await sheets.append(spreadsheetId, tab, cells);
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'unknown error';
      this.logger.warn({ shopId, tab, reason }, 'ledger rows not sent yet');
      const now = this.now().getTime();
      await withShop(this.db, shopId, async (tx) => {
        for (const row of rows) {
          await this.repo.markFailed(
            tx,
            row.id,
            reason,
            new Date(now + retryDelayMs(row.attempts)),
          );
        }
      });
      return false;
    }
    await withShop(this.db, shopId, (tx) =>
      this.repo.markSent(
        tx,
        rows.map((row) => row.id),
        this.now(),
      ),
    );
    return true;
  }
}
