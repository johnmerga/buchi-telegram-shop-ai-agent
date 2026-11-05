import type { ProductInput, VariantInput } from '@buchi/shared';
import type { Database } from '../../db/client';
import { isCheckViolation } from '../../db/errors';
import { withShop } from '../../db/with-shop';
import { AppError } from '../../shared/errors';
import { availableSizes, buyLink, postContent } from './catalog.domain';
import type { CatalogRepo, ProductRow, VariantRow } from './catalog.repo';

/** Posts to a Telegram channel. Telegram is the only implementation. */
export interface ChannelPublisher {
  publish(post: {
    chatId: number;
    photoFileId: string | undefined;
    caption: string;
    buttonText: string;
    buttonUrl: string;
  }): Promise<number>;
}

export interface ShopChannelLookup {
  channelChatId(shopId: string): Promise<number | null>;
}

export interface ProductWithVariants extends ProductRow {
  variants: VariantRow[];
}

export interface VariantForSale {
  variant: VariantRow;
  product: ProductRow;
}

export class CatalogService {
  constructor(
    private readonly db: Database,
    private readonly repo: CatalogRepo,
    private readonly shops: ShopChannelLookup,
    private readonly publisher: ChannelPublisher,
    private readonly botUsername: string,
  ) {}

  createProduct(shopId: string, input: ProductInput): Promise<ProductRow> {
    return withShop(this.db, shopId, (tx) => this.repo.insertProduct(tx, shopId, input));
  }

  updateProduct(shopId: string, productId: string, input: ProductInput): Promise<ProductRow> {
    return withShop(this.db, shopId, async (tx) => {
      const row = await this.repo.updateProduct(tx, productId, input);
      if (!row) throw productNotFound();
      return row;
    });
  }

  listProducts(shopId: string): Promise<ProductWithVariants[]> {
    return withShop(this.db, shopId, async (tx) => {
      const [rows, variants] = await Promise.all([
        this.repo.listProducts(tx),
        this.repo.listVariants(tx),
      ]);
      return rows.map((row) => ({
        ...row,
        variants: variants.filter((variant) => variant.productId === row.id),
      }));
    });
  }

  async setVariants(shopId: string, productId: string, variants: VariantInput[]): Promise<void> {
    try {
      await withShop(this.db, shopId, async (tx) => {
        if (!(await this.repo.findProduct(tx, productId))) throw productNotFound();
        await this.repo.upsertVariants(tx, shopId, productId, variants);
      });
    } catch (err) {
      if (isCheckViolation(err)) {
        throw new AppError('CONFLICT', 'Stock cannot go below the units reserved by open orders');
      }
      throw err;
    }
  }

  /** Opens a Buy link: finds the post's shop and product, and counts the tap. */
  async openPost(
    postId: string,
  ): Promise<{ shopId: string; product: ProductWithVariants } | undefined> {
    const shopId = await this.repo.shopOfPost(this.db, postId);
    if (!shopId) return undefined;
    return withShop(this.db, shopId, async (tx) => {
      const productId = await this.repo.tapPost(tx, postId);
      const product = productId ? await this.repo.findProduct(tx, productId) : undefined;
      if (!product?.active) return undefined;
      return {
        shopId,
        product: { ...product, variants: await this.repo.listVariants(tx, product.id) },
      };
    });
  }

  variantForSale(shopId: string, variantId: string): Promise<VariantForSale | undefined> {
    return withShop(this.db, shopId, async (tx) => {
      const variant = await this.repo.findVariant(tx, variantId);
      const product = variant ? await this.repo.findProduct(tx, variant.productId) : undefined;
      return variant && product?.active ? { variant, product } : undefined;
    });
  }

  /** The most recent products across an owner's shops, for choosing where a photo goes. */
  async recentProducts(shopIds: string[], limit: number): Promise<ProductRow[]> {
    const perShop = await Promise.all(
      shopIds.map((shopId) => withShop(this.db, shopId, (tx) => this.repo.listProducts(tx))),
    );
    return perShop
      .flat()
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  /** Attaches a photo to a product in whichever of the owner's shops holds it. */
  async attachPhoto(shopIds: string[], productId: string, fileId: string): Promise<ProductRow> {
    for (const shopId of shopIds) {
      const product = await withShop(this.db, shopId, async (tx) =>
        (await this.repo.addPhoto(tx, productId, fileId))
          ? this.repo.findProduct(tx, productId)
          : undefined,
      );
      if (product) return product;
    }
    throw productNotFound();
  }

  /** Records the post first, because its ID goes into the Buy link that the post carries. */
  async postToChannel(shopId: string, productId: string): Promise<{ postId: string }> {
    const chatId = await this.shops.channelChatId(shopId);
    if (chatId === null) throw new AppError('CONFLICT', 'Connect a channel before posting');

    const { product, variants, postId } = await withShop(this.db, shopId, async (tx) => {
      const found = await this.repo.findProduct(tx, productId);
      if (!found) throw productNotFound();
      return {
        product: found,
        variants: await this.repo.listVariants(tx, productId),
        postId: await this.repo.insertPost(tx, { shopId, productId, chatId }),
      };
    });

    const sizes = availableSizes(variants);
    if (sizes.length === 0) {
      await withShop(this.db, shopId, (tx) => this.repo.deletePost(tx, postId));
      throw new AppError('CONFLICT', 'The product has no stock to sell');
    }

    const content = postContent(product, sizes);
    try {
      const messageId = await this.publisher.publish({
        chatId,
        photoFileId: product.photoFileIds[0],
        caption: content.caption,
        buttonText: content.buttonText,
        buttonUrl: buyLink(this.botUsername, postId),
      });
      await withShop(this.db, shopId, (tx) => this.repo.setPostMessage(tx, postId, messageId));
    } catch (err) {
      await withShop(this.db, shopId, (tx) => this.repo.deletePost(tx, postId));
      throw err;
    }
    return { postId };
  }
}

const productNotFound = () => new AppError('NOT_FOUND', 'Product not found');
