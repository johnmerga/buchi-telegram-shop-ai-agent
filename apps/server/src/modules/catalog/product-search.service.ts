import type { Logger } from 'pino';
import type { LanguageModel } from '../../ai/language-model';
import { failureOf } from '../../ai/structured-output';
import type { Database } from '../../db/client';
import { withShop } from '../../db/with-shop';
import { SIMILAR_PRODUCT_DISTANCE } from './catalog.domain';
import type { CatalogRepo } from './catalog.repo';
import type { CatalogService, ProductWithVariants } from './catalog.service';

/**
 * The customer's words against the shop's products. Products whose title or description contains
 * the words come first; products close in meaning follow, so a question in Amharic or with another
 * word for a product still finds the English listing.
 */
export class ProductSearch {
  constructor(
    private readonly db: Database,
    private readonly repo: CatalogRepo,
    private readonly catalog: Pick<CatalogService, 'search' | 'activeProducts'>,
    private readonly embedder: Pick<LanguageModel, 'embed'>,
    private readonly logger: Logger,
  ) {}

  async search(shopId: string, query: string, limit: number): Promise<ProductWithVariants[]> {
    const byWords = await this.catalog.search(shopId, query, limit);
    if (query.trim() === '' || byWords.length >= limit) return byWords;
    const listed = new Set(byWords.map((product) => product.id));
    const closeIds = (await this.closeInMeaning(shopId, query, limit)).filter(
      (id) => !listed.has(id),
    );
    const byMeaning = await this.catalog.activeProducts(shopId, closeIds);
    return [...byWords, ...byMeaning].slice(0, limit);
  }

  /** Without an embedding, the search keeps the products found by their words. */
  private async closeInMeaning(shopId: string, query: string, limit: number): Promise<string[]> {
    let embedding: number[];
    try {
      embedding = await this.embedder.embed(query, 'customer');
    } catch (err) {
      this.logger.warn(
        { step: 'embed_query', failure: failureOf(err) },
        'product search by meaning failed',
      );
      return [];
    }
    return withShop(this.db, shopId, (tx) =>
      this.repo.nearestProducts(tx, embedding, SIMILAR_PRODUCT_DISTANCE, limit),
    );
  }
}
