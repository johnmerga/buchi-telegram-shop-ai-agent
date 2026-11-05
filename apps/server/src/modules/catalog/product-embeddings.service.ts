import type { Logger } from 'pino';
import type { LanguageModel } from '../../ai/language-model';
import { failureOf } from '../../ai/structured-output';
import type { Database, Transaction } from '../../db/client';
import { PRODUCT_EMBEDDING_DIMENSIONS } from '../../db/schema';
import { withShop } from '../../db/with-shop';
import type { EventBus } from '../../shared/events';
import type { TimerService } from '../jobs/timers.service';
import { embeddingText } from './catalog.domain';
import type { CatalogRepo } from './catalog.repo';
import type { ProductEmbeddingQueue } from './catalog.service';

export const PRODUCT_EMBEDDING_TIMER = 'product.embed';

/** Long enough for the daily or per-minute Gemini quota to recover. */
const RETRY_AFTER_MS = 60 * 60 * 1000;

/**
 * Embeds product text for photo search in a timer, scheduled in the transaction that saves the
 * product. Saving never waits for Gemini, and when Gemini is unavailable the timer tries again
 * later; until then photo search simply does not find that product.
 */
export class ProductEmbeddingService implements ProductEmbeddingQueue {
  constructor(
    private readonly db: Database,
    private readonly repo: CatalogRepo,
    private readonly model: Pick<LanguageModel, 'embed'>,
    private readonly timers: Pick<TimerService, 'schedule'>,
    private readonly now: () => Date,
    private readonly logger: Logger,
    private readonly events: Pick<EventBus, 'publish'>,
  ) {}

  async enqueue(tx: Transaction, shopId: string, productId: string): Promise<void> {
    await this.timers.schedule(tx, PRODUCT_EMBEDDING_TIMER, productId, shopId, this.now());
  }

  /** The timer handler. A product deleted or changed meanwhile finishes the timer without a write. */
  async embed(timer: { targetId: string; shopId: string | null }): Promise<void> {
    const { shopId, targetId: productId } = timer;
    if (shopId === null) throw new Error('A product embedding timer needs a shop');
    const product = await withShop(this.db, shopId, (tx) => this.repo.findProduct(tx, productId));
    if (!product) return;

    const text = embeddingText(product);
    let embedding: number[];
    try {
      embedding = await this.model.embed(text, 'owner');
    } catch (err) {
      this.logger.warn({ productId, failure: failureOf(err) }, 'product embedding postponed');
      const retryAt = new Date(this.now().getTime() + RETRY_AFTER_MS);
      await withShop(this.db, shopId, (tx) =>
        this.timers.schedule(tx, PRODUCT_EMBEDDING_TIMER, productId, shopId, retryAt),
      );
      return;
    }
    if (embedding.length !== PRODUCT_EMBEDDING_DIMENSIONS) {
      throw new Error(`The embedding has ${String(embedding.length)} dimensions`);
    }
    const stored = await withShop(this.db, shopId, async (tx) => {
      const current = await this.repo.findProduct(tx, productId);
      // A newer timer embeds the changed text, so this older vector is not stored.
      if (!current || embeddingText(current) !== text) return false;
      await this.repo.setEmbedding(tx, productId, embedding);
      return true;
    });
    if (stored) await this.events.publish('product.embedded', { shopId, productId, embedding });
  }
}
