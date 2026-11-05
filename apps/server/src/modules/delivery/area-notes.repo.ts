import { and, desc, eq, gt } from 'drizzle-orm';
import type { Transaction } from '../../db/client';
import { areaNotes } from '../../db/schema';

export type AreaNoteRow = typeof areaNotes.$inferSelect;
type NewAreaNote = typeof areaNotes.$inferInsert;

export class AreaNotesRepo {
  async insert(tx: Transaction, note: NewAreaNote): Promise<void> {
    await tx.insert(areaNotes).values(note);
  }

  /** The zone's notes that have not expired, newest first. */
  current(tx: Transaction, zone: string, now: Date): Promise<AreaNoteRow[]> {
    return tx
      .select()
      .from(areaNotes)
      .where(and(eq(areaNotes.zone, zone), gt(areaNotes.expiresAt, now)))
      .orderBy(desc(areaNotes.createdAt));
  }
}
