import type { Logger } from 'pino';
import type { LanguageModel } from '../../ai/language-model';
import { productPhotoPrompt } from '../../ai/prompts/product-photo';
import { failureOf, jsonSchemaOf, parseJson } from '../../ai/structured-output';
import type { Database } from '../../db/client';
import { withShop } from '../../db/with-shop';
import type { DemandService } from '../demand/demand.service';
import { photoQueryText } from './catalog.domain';
import type { CatalogRepo } from './catalog.repo';
import { productPhotoSchema, type ProductPhoto } from './catalog.schemas';
import type { CatalogService, ProductWithVariants } from './catalog.service';

/** What the customer is shown: similar products, or **Notify me** for the recorded demand. */
export type PhotoSearchAnswer =
  { status: 'found'; products: ProductWithVariants[] } | { status: 'not_found'; signalId: string };

export type PhotoSearchResult = PhotoSearchAnswer | { status: 'unavailable' };

const MAX_MATCHES = 3;
/**
 * The largest cosine distance (1 minus cosine similarity) at which a product still counts as the
 * one in the photo. Task 10.1's product photo set tunes it against real photos.
 */
const MAX_COSINE_DISTANCE = 0.3;

/**
 * Finds the shop's products that look like a customer's photo: the fast model describes the
 * photo, the description is embedded, and `pgvector` finds the closest product embeddings.
 */
export class PhotoSearchService {
  constructor(
    private readonly db: Database,
    private readonly repo: CatalogRepo,
    private readonly catalog: Pick<CatalogService, 'activeProducts'>,
    private readonly model: LanguageModel,
    private readonly demand: Pick<DemandService, 'recordUnmet'>,
    private readonly logger: Logger,
  ) {}

  async search(
    shopId: string,
    customerId: string,
    image: { mimeType: string; data: string },
  ): Promise<PhotoSearchResult> {
    const photo = await this.describe(image);
    if (!photo) return { status: 'unavailable' };
    const query = photoQueryText(photo);
    let embedding: number[];
    try {
      embedding = await this.model.embed(query, 'customer');
    } catch (err) {
      this.logger.warn({ step: 'embed_photo', failure: failureOf(err) }, 'photo search failed');
      return { status: 'unavailable' };
    }

    const ids = await withShop(this.db, shopId, (tx) =>
      this.repo.nearestProducts(tx, embedding, MAX_COSINE_DISTANCE, MAX_MATCHES),
    );
    const products = await this.catalog.activeProducts(shopId, ids);
    if (products.length > 0) return { status: 'found', products };
    return {
      status: 'not_found',
      signalId: await this.demand.recordUnmet(shopId, customerId, query),
    };
  }

  private async describe(image: {
    mimeType: string;
    data: string;
  }): Promise<ProductPhoto | undefined> {
    let text: string | undefined;
    try {
      const result = await this.model.generate({
        tier: 'fast',
        priority: 'customer',
        systemInstruction: productPhotoPrompt.text,
        contents: [{ role: 'user', parts: [{ inlineData: image }] }],
        responseJsonSchema: jsonSchemaOf(productPhotoSchema),
      });
      text = result.text;
    } catch (err) {
      this.logger.warn({ step: 'describe_photo', failure: failureOf(err) }, 'photo search failed');
      return undefined;
    }
    const parsed = productPhotoSchema.safeParse(parseJson(text));
    if (parsed.success) return parsed.data;
    this.logger.warn({ step: 'describe_photo', failure: 'invalid_output' }, 'photo search failed');
    return undefined;
  }
}
