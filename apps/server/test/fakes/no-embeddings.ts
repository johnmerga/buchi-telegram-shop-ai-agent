import type { ProductEmbeddingQueue } from '../../src/modules/catalog/catalog.service';

/** For tests that do not search by photo: saving a product schedules no embedding. */
export const noEmbeddings: ProductEmbeddingQueue = { enqueue: () => Promise.resolve() };
