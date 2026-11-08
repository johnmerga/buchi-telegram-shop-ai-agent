import type { Logger } from 'pino';
import type { LanguageModel } from '../../ai/language-model';
import { failureOf } from '../../ai/structured-output';
import type { Database } from '../../db/client';
import { withShop } from '../../db/with-shop';
import { rankSearchResults, searchTerms, SIMILAR_PRODUCT_DISTANCE } from './catalog.domain';
import type { CatalogRepo } from './catalog.repo';
import type { CatalogService, ProductWithVariants } from './catalog.service';

/** How many products each search method offers the ranking, more than any search shows. */
const CANDIDATES = 20;

/**
 * The customer's words against the shop's products, by their words and by meaning, so a question
 * in Amharic or with another word for a product still finds the English listing. The ranking puts
 * exact matches first and keeps products that share only a generic word last.
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
    const terms = searchTerms(query);
    if (terms.length === 0) return this.catalog.search(shopId, query, limit);
    const [byWords, byMeaning] = await Promise.all([
      this.catalog.search(shopId, query, CANDIDATES),
      this.closeInMeaning(shopId, query, CANDIDATES),
    ]);
    const ranked = rankSearchResults(terms, byWords, byMeaning, limit);
    const known = new Map(byWords.map((product) => [product.id, product]));
    const missing = ranked.filter((id) => !known.has(id));
    for (const product of await this.catalog.activeProducts(shopId, missing)) {
      known.set(product.id, product);
    }
    return ranked.flatMap((id) => {
      const product = known.get(id);
      return product ? [product] : [];
    });
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
