import { and, desc, gte, inArray } from 'drizzle-orm';
import type { Transaction } from '../../db/client';
import { areaNotes } from '../../db/schema';

export type AreaNoteRow = typeof areaNotes.$inferSelect;

export class AreaNotesRepo {
  async insert(
    tx: Transaction,
    note: { shopId: string; zone: string; note: string; synthetic: boolean; createdAt?: Date },
  ): Promise<void> {
    await tx.insert(areaNotes).values(note);
  }

  recent(tx: Transaction, zones: string[], since: Date, limit: number): Promise<AreaNoteRow[]> {
    return tx
      .select()
      .from(areaNotes)
      .where(and(inArray(areaNotes.zone, zones), gte(areaNotes.createdAt, since)))
      .orderBy(desc(areaNotes.createdAt))
      .limit(limit);
  }
}
