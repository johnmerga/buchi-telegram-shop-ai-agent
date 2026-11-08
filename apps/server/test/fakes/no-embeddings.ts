import type { LanguageModel } from '../../src/ai/language-model';
import { PRODUCT_EMBEDDING_DIMENSIONS } from '../../src/db/schema';
import type { ProductEmbeddingQueue } from '../../src/modules/catalog/catalog.service';

/** For tests that do not search by photo: saving a product schedules no embedding. */
export const noEmbeddings: ProductEmbeddingQueue = { enqueue: () => Promise.resolve() };

/**
 * For tests whose products have no embeddings: a query gets a fixed vector, so a search by meaning
 * finds nothing and the results are the ones found by words.
 */
export const fixedQueryEmbedding: Pick<LanguageModel, 'embed'> = {
  embed: () => Promise.resolve(unitVector()),
};

function unitVector(): number[] {
  return Array.from({ length: PRODUCT_EMBEDDING_DIMENSIONS }, (_, i) => (i === 0 ? 1 : 0));
}
