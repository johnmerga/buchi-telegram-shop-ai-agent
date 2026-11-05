import { countDistinct, inArray } from 'drizzle-orm';
import type { Database } from '../../db/client';
import { riskSignals } from '../../db/schema';

export type RiskSignalKind = (typeof riskSignals.$inferInsert)['kind'];

/** Platform-wide: a payer's signals count across every shop, so it uses no shop context. */
export class RiskSignalsRepo {
  constructor(private readonly db: Database) {}

  async insert(shopId: string, kind: RiskSignalKind, payerHashes: string[]): Promise<void> {
    await this.db
      .insert(riskSignals)
      .values(payerHashes.map((payerHash) => ({ payerHash, shopId, kind })));
  }

  /** How many shops have recorded a signal for any of these payer hashes. */
  async shopCount(payerHashes: string[]): Promise<number> {
    const [row] = await this.db
      .select({ shops: countDistinct(riskSignals.shopId) })
      .from(riskSignals)
      .where(inArray(riskSignals.payerHash, payerHashes));
    return row?.shops ?? 0;
  }
}
