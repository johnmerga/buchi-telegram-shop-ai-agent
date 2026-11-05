import type { ProductInput, VariantInput } from '@buchi/shared';
import { eq, sql } from 'drizzle-orm';
import type { Database, Transaction } from '../../db/client';
import { channelPosts, products, productVariants } from '../../db/schema';

export type ProductRow = typeof products.$inferSelect;
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
      .returning();
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
      .returning();
    return row;
  }

  async findProduct(tx: Transaction, productId: string): Promise<ProductRow | undefined> {
    const [row] = await tx.select().from(products).where(eq(products.id, productId));
    return row;
  }

  listProducts(tx: Transaction): Promise<ProductRow[]> {
    return tx.select().from(products).orderBy(products.createdAt);
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
