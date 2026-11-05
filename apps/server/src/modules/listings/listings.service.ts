import type { MoneyString } from '@buchi/shared';
import type { Logger } from 'pino';
import type { LanguageModel } from '../../ai/language-model';
import { draftListingPrompt } from '../../ai/prompts/draft-listing';
import { failureOf, jsonSchemaOf, parseJson } from '../../ai/structured-output';
import type { Database } from '../../db/client';
import { withShop } from '../../db/with-shop';
import { AppError } from '../../shared/errors';
import type { CatalogService } from '../catalog/catalog.service';
import type { ImageFiles } from '../payments/image-intake.service';
import { readOwnerNote, readPriceReply } from './listing-text.domain';
import { isPriced, listingOf, type DraftView } from './listings.domain';
import type { DraftRow, ListingsRepo } from './listings.repo';
import { listingDraftSchema, type ListingDraft } from './listings.schemas';

interface Photo {
  fileId: string;
  mediaGroupId: string | undefined;
}

interface MessageRef {
  chatId: number;
  messageId: number;
}

export type PostResult =
  | { status: 'posted' | 'saved_only'; title: string; problem?: string }
  | { status: 'not_found' | 'needs_prices' };

/**
 * Snap-to-list: a product drafted from the owner's photo and short note. The model writes the
 * words; the price comes only from the owner's note or their private reply, so a listing never
 * gets a price the owner did not write.
 */
export class ListingService {
  constructor(
    private readonly db: Database,
    private readonly repo: ListingsRepo,
    private readonly model: LanguageModel,
    private readonly files: ImageFiles,
    private readonly catalog: Pick<CatalogService, 'createListing' | 'postToChannel'>,
    private readonly logger: Logger,
  ) {}

  /** Returns undefined when the model could not draft it, so the owner can send it again. */
  async draft(shopId: string, note: string, photo: Photo): Promise<DraftView | undefined> {
    const draft = await this.drafted(note, [photo.fileId]);
    if (!draft) return undefined;
    const owner = readOwnerNote(note);
    const row = await withShop(this.db, shopId, (tx) =>
      this.repo.insert(tx, {
        shopId,
        ownerText: note,
        photoFileIds: [photo.fileId],
        mediaGroupId: photo.mediaGroupId ?? null,
        draft,
        pricingMode: owner.pricingMode,
        price: owner.price ?? null,
        stockPerSize: owner.stockPerSize,
      }),
    );
    return viewOf(row);
  }

  /** Telegram sends an album photo by photo, with the note on one of them. */
  addAlbumPhoto(shopId: string, mediaGroupId: string, fileId: string): Promise<boolean> {
    return withShop(this.db, shopId, (tx) => this.repo.addAlbumPhoto(tx, mediaGroupId, fileId));
  }

  async setPreview(shopId: string, draftId: string, preview: MessageRef): Promise<void> {
    await withShop(this.db, shopId, (tx) => this.repo.setPreview(tx, draftId, preview));
  }

  /**
   * The owner's reply to a draft: prices only, or a new note that drafts it again. Returns
   * undefined when the message is not a draft, and 'unavailable' when the model cannot redraft.
   */
  async reply(
    shopId: string,
    preview: MessageRef,
    text: string,
  ): Promise<DraftView | 'unavailable' | undefined> {
    const row = await withShop(this.db, shopId, (tx) => this.repo.findByPreview(tx, preview));
    if (!row) return undefined;
    const prices = readPriceReply(text);
    if (prices) {
      // Prices that do not fit the draft, such as two for a fixed price, change nothing.
      const priced = pricesFor(row, prices);
      return priced ? this.updated(shopId, row.id, priced) : viewOf(row);
    }

    const draft = await this.drafted(text, row.photoFileIds);
    if (!draft) return 'unavailable';
    const owner = readOwnerNote(text);
    return this.updated(shopId, row.id, {
      ownerText: text,
      draft,
      pricingMode: owner.pricingMode,
      price: owner.price ?? null,
      lowestPrice: null,
      stockPerSize: owner.stockPerSize,
    });
  }

  /**
   * Saves the product with its sizes and photos, then posts it to the channel. A failed post keeps
   * the product in the inventory, where the owner can post it again.
   */
  async post(shopId: string, draftId: string): Promise<PostResult> {
    const row = await withShop(this.db, shopId, (tx) => this.repo.close(tx, draftId, 'posted'));
    if (!row) return { status: 'not_found' };
    const view = viewOf(row);
    if (!isPriced(view)) {
      await withShop(this.db, shopId, (tx) => this.repo.reopen(tx, draftId));
      return { status: 'needs_prices' };
    }
    let product: Awaited<ReturnType<CatalogService['createListing']>>;
    try {
      product = await this.catalog.createListing(shopId, {
        ...listingOf(view),
        photoFileIds: row.photoFileIds,
      });
    } catch (err) {
      await withShop(this.db, shopId, (tx) => this.repo.reopen(tx, draftId));
      throw err;
    }
    await withShop(this.db, shopId, (tx) => this.repo.setProduct(tx, draftId, product.id));
    try {
      await this.catalog.postToChannel(shopId, product.id);
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      return { status: 'saved_only', title: product.title, problem: err.message };
    }
    return { status: 'posted', title: product.title };
  }

  async discard(shopId: string, draftId: string): Promise<boolean> {
    const row = await withShop(this.db, shopId, (tx) => this.repo.close(tx, draftId, 'discarded'));
    return row !== undefined;
  }

  private async updated(
    shopId: string,
    draftId: string,
    change: Parameters<ListingsRepo['update']>[2],
  ): Promise<DraftView | undefined> {
    const row = await withShop(this.db, shopId, (tx) => this.repo.update(tx, draftId, change));
    return row && viewOf(row);
  }

  /** The vision model drafts from the first photo; the others only join the listing. */
  private async drafted(note: string, photoFileIds: string[]): Promise<ListingDraft | undefined> {
    const [fileId] = photoFileIds;
    if (!fileId) return undefined;
    let text: string | undefined;
    try {
      const image = { mimeType: 'image/jpeg', data: await this.files.download(fileId) };
      const result = await this.model.generate({
        tier: 'smart',
        priority: 'owner',
        systemInstruction: draftListingPrompt.text,
        contents: [{ role: 'user', parts: [{ inlineData: image }, { text: note }] }],
        responseJsonSchema: jsonSchemaOf(listingDraftSchema),
      });
      text = result.text;
    } catch (err) {
      this.logger.warn({ step: 'draft_listing', failure: failureOf(err) }, 'listing draft failed');
      return undefined;
    }
    const parsed = listingDraftSchema.safeParse(parseJson(text));
    if (parsed.success) return parsed.data;
    this.logger.warn({ step: 'draft_listing', failure: 'invalid_output' }, 'listing draft failed');
    return undefined;
  }
}

/** One price sets a fixed price; two set a negotiable product's asking and lowest prices. */
function pricesFor(row: DraftRow, prices: MoneyString[]) {
  const [first, second] = prices;
  if (first === undefined) return undefined;
  if (row.pricingMode === 'fixed') {
    return second === undefined ? { price: first, lowestPrice: null } : undefined;
  }
  return second === undefined ? undefined : { price: first, lowestPrice: second };
}

function viewOf(row: DraftRow): DraftView {
  return {
    id: row.id,
    draft: listingDraftSchema.parse(row.draft),
    pricingMode: row.pricingMode,
    price: row.price,
    lowestPrice: row.lowestPrice,
    stockPerSize: row.stockPerSize,
  };
}
