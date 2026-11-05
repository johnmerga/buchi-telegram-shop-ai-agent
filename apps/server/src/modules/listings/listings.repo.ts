import type { MoneyString, PricingMode } from '@buchi/shared';
import { and, eq, sql } from 'drizzle-orm';
import type { Transaction } from '../../db/client';
import { listingDrafts } from '../../db/schema';

export type DraftRow = typeof listingDrafts.$inferSelect;
type NewDraft = typeof listingDrafts.$inferInsert;

/** The parts of a draft that a new note from the owner replaces. */
interface Redraft {
  ownerText: string;
  draft: Record<string, unknown>;
  pricingMode: PricingMode;
  price: MoneyString | null;
  lowestPrice: null;
  stockPerSize: number;
}

const open = eq(listingDrafts.status, 'draft');

export class ListingsRepo {
  async insert(tx: Transaction, draft: NewDraft): Promise<DraftRow> {
    const [row] = await tx.insert(listingDrafts).values(draft).returning();
    if (!row) throw new Error('Insert returned no listing draft');
    return row;
  }

  async findOpen(tx: Transaction, draftId: string): Promise<DraftRow | undefined> {
    const [row] = await tx
      .select()
      .from(listingDrafts)
      .where(and(eq(listingDrafts.id, draftId), open));
    return row;
  }

  async findByPreview(
    tx: Transaction,
    preview: { chatId: number; messageId: number },
  ): Promise<DraftRow | undefined> {
    const [row] = await tx
      .select()
      .from(listingDrafts)
      .where(
        and(
          eq(listingDrafts.previewChatId, preview.chatId),
          eq(listingDrafts.previewMessageId, preview.messageId),
          open,
        ),
      );
    return row;
  }

  /** Adds a photo to the open draft of an album. Returns false when no draft has the album. */
  async addAlbumPhoto(tx: Transaction, mediaGroupId: string, fileId: string): Promise<boolean> {
    const updated = await tx
      .update(listingDrafts)
      .set({ photoFileIds: sql`array_append(${listingDrafts.photoFileIds}, ${fileId})` })
      .where(and(eq(listingDrafts.mediaGroupId, mediaGroupId), open))
      .returning({ id: listingDrafts.id });
    return updated.length > 0;
  }

  async setPreview(
    tx: Transaction,
    draftId: string,
    preview: { chatId: number; messageId: number },
  ): Promise<void> {
    await tx
      .update(listingDrafts)
      .set({ previewChatId: preview.chatId, previewMessageId: preview.messageId })
      .where(eq(listingDrafts.id, draftId));
  }

  async update(
    tx: Transaction,
    draftId: string,
    change: Redraft | { price: MoneyString; lowestPrice: MoneyString | null },
  ): Promise<DraftRow | undefined> {
    const [row] = await tx
      .update(listingDrafts)
      .set(change)
      .where(and(eq(listingDrafts.id, draftId), open))
      .returning();
    return row;
  }

  /** Closes an open draft in one statement, so a double tap posts or discards it only once. */
  async close(
    tx: Transaction,
    draftId: string,
    status: 'posted' | 'discarded',
  ): Promise<DraftRow | undefined> {
    const [row] = await tx
      .update(listingDrafts)
      .set({ status })
      .where(and(eq(listingDrafts.id, draftId), open))
      .returning();
    return row;
  }

  async reopen(tx: Transaction, draftId: string): Promise<void> {
    await tx.update(listingDrafts).set({ status: 'draft' }).where(eq(listingDrafts.id, draftId));
  }

  async setProduct(tx: Transaction, draftId: string, productId: string): Promise<void> {
    await tx.update(listingDrafts).set({ productId }).where(eq(listingDrafts.id, draftId));
  }
}
