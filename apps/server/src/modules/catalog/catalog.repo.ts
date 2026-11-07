import type { ProductInput, VariantInput } from '@buchi/shared';
import {
  and,
  asc,
  cosineDistance,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  lte,
  or,
  sql,
} from 'drizzle-orm';
import type { Database, Transaction } from '../../db/client';
import { channelPosts, products, productVariants } from '../../db/schema';

/** Every product column but the embedding, which only photo search reads, inside the database. */
const productColumns = {
  id: products.id,
  shopId: products.shopId,
  title: products.title,
  description: products.description,
  pricingMode: products.pricingMode,
  price: products.price,
  lowestPrice: products.lowestPrice,
  photoFileIds: products.photoFileIds,
  active: products.active,
  createdAt: products.createdAt,
};

export type ProductRow = Omit<typeof products.$inferSelect, 'embedding' | 'synthetic'>;
export type VariantRow = typeof productVariants.$inferSelect;

const productValues = (input: ProductInput) => ({
  title: input.title,
  description: input.description,
  pricingMode: input.pricingMode,
  price: input.price,
  lowestPrice: input.pricingMode === 'negotiable' ? input.lowestPrice : null,
});

export class CatalogRepo {
  async insertProduct(tx: Transaction, shopId: string, input: ProductInput): Promise<ProductRow> {
    const [row] = await tx
      .insert(products)
      .values({ shopId, ...productValues(input) })
      .returning(productColumns);
    if (!row) throw new Error('Insert returned no product');
    return row;
  }

  async updateProduct(
    tx: Transaction,
    productId: string,
    input: ProductInput,
  ): Promise<ProductRow | undefined> {
    const [row] = await tx
      .update(products)
      .set(productValues(input))
      .where(eq(products.id, productId))
      .returning(productColumns);
    return row;
  }

  async findProduct(tx: Transaction, productId: string): Promise<ProductRow | undefined> {
    const [row] = await tx.select(productColumns).from(products).where(eq(products.id, productId));
    return row;
  }

  listProducts(tx: Transaction): Promise<ProductRow[]> {
    return tx.select(productColumns).from(products).orderBy(products.createdAt);
  }

  /** Active products whose title or description contains any of the terms, newest first. */
  searchProducts(tx: Transaction, terms: string[], limit: number): Promise<ProductRow[]> {
    const matches = terms.flatMap((term) => {
      const pattern = `%${escapeLike(term)}%`;
      return [ilike(products.title, pattern), ilike(products.description, pattern)];
    });
    return tx
      .select(productColumns)
      .from(products)
      .where(and(eq(products.active, true), or(...matches)))
      .orderBy(desc(products.createdAt))
      .limit(limit);
  }

  findProducts(tx: Transaction, productIds: string[]): Promise<ProductRow[]> {
    return tx.select(productColumns).from(products).where(inArray(products.id, productIds));
  }

  variantsOf(tx: Transaction, productIds: string[]): Promise<VariantRow[]> {
    return tx
      .select()
      .from(productVariants)
      .where(inArray(productVariants.productId, productIds))
      .orderBy(asc(productVariants.size));
  }

  async setEmbedding(
    tx: Transaction,
    productId: string,
    embedding: number[] | null,
  ): Promise<void> {
    await tx.update(products).set({ embedding }).where(eq(products.id, productId));
  }

  /** The active products closest to an embedding, within a cosine distance. */
  async nearestProducts(
    tx: Transaction,
    embedding: number[],
    maxDistance: number,
    limit: number,
  ): Promise<string[]> {
    const distance = cosineDistance(products.embedding, embedding);
    const rows = await tx
      .select({ id: products.id })
      .from(products)
      .where(
        and(eq(products.active, true), isNotNull(products.embedding), lte(distance, maxDistance)),
      )
      .orderBy(distance)
      .limit(limit);
    return rows.map((row) => row.id);
  }

  listVariants(tx: Transaction, productId?: string): Promise<VariantRow[]> {
    const query = tx.select().from(productVariants);
    return productId ? query.where(eq(productVariants.productId, productId)) : query;
  }

  /** Adds new sizes and updates the stock of existing ones. Removing a size means stock 0. */
  async upsertVariants(
    tx: Transaction,
    shopId: string,
    productId: string,
    variants: VariantInput[],
  ): Promise<void> {
    await tx
      .insert(productVariants)
      .values(variants.map((variant) => ({ ...variant, shopId, productId })))
      .onConflictDoUpdate({
        target: [productVariants.productId, productVariants.size, productVariants.color],
        set: { stock: sql`excluded.stock` },
      });
  }

  async addPhoto(tx: Transaction, productId: string, fileId: string): Promise<boolean> {
    const updated = await tx
      .update(products)
      .set({ photoFileIds: sql`array_append(${products.photoFileIds}, ${fileId})` })
      .where(eq(products.id, productId))
      .returning({ id: products.id });
    return updated.length > 0;
  }

  /** Resolves a Buy link's post to its shop through the `channel_post_shop_id` function. */
  async shopOfPost(db: Database, postId: string): Promise<string | undefined> {
    const [row] = await db.execute<{ shop_id: string | null }>(
      sql`select channel_post_shop_id(${postId}) as shop_id`,
    );
    return row?.shop_id ?? undefined;
  }

  /** Counts a Buy tap and returns the post's product. */
  async tapPost(tx: Transaction, postId: string): Promise<string | undefined> {
    const [row] = await tx
      .update(channelPosts)
      .set({ taps: sql`${channelPosts.taps} + 1` })
      .where(eq(channelPosts.id, postId))
      .returning({ productId: channelPosts.productId });
    return row?.productId;
  }

  async findVariant(tx: Transaction, variantId: string): Promise<VariantRow | undefined> {
    const [row] = await tx.select().from(productVariants).where(eq(productVariants.id, variantId));
    return row;
  }

  async insertPost(
    tx: Transaction,
    post: { shopId: string; productId: string; chatId: number },
  ): Promise<string> {
    const [row] = await tx.insert(channelPosts).values(post).returning({ id: channelPosts.id });
    if (!row) throw new Error('Insert returned no channel post');
    return row.id;
  }

  async setPostMessage(tx: Transaction, postId: string, messageId: number): Promise<void> {
    await tx.update(channelPosts).set({ messageId }).where(eq(channelPosts.id, postId));
  }

  async deletePost(tx: Transaction, postId: string): Promise<void> {
    await tx.delete(channelPosts).where(eq(channelPosts.id, postId));
  }
}

/** Search terms come from the model, so `%` and `_` match themselves, not any text. */
function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, '\\$&');
}
