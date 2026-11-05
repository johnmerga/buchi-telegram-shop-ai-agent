import { pricingModes } from '@buchi/shared';
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  foreignKey,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';
import { shopIsolation } from './rls';
import { shops } from './shops';

export const pricingMode = pgEnum('pricing_mode', pricingModes);

/** The size Buchi requests from the Gemini embedding model, so stored and query vectors match. */
export const PRODUCT_EMBEDDING_DIMENSIONS = 768;

/**
 * Child rows reference their product by (product, shop). Foreign key checks ignore row-level
 * security, so a plain product reference could point into another shop.
 */
const sameShopProduct = (t: { productId: AnyPgColumn; shopId: AnyPgColumn }) =>
  foreignKey({
    columns: [t.productId, t.shopId],
    foreignColumns: [products.id, products.shopId],
  }).onDelete('cascade');

const shopId = () =>
  uuid('shop_id')
    .notNull()
    .references(() => shops.id, { onDelete: 'cascade' });

export const products = pgTable(
  'products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: shopId(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    pricingMode: pricingMode('pricing_mode').notNull(),
    /** The shown price of a fixed-price product, or the private asking price of a negotiable one. */
    price: numeric('price', { precision: 12, scale: 2 }).notNull(),
    lowestPrice: numeric('lowest_price', { precision: 12, scale: 2 }),
    photoFileIds: text('photo_file_ids')
      .array()
      .notNull()
      .default(sql`'{}'`),
    active: boolean('active').notNull().default(true),
    /** The title and description embedded for photo search. Null until the background job runs. */
    embedding: vector('embedding', { dimensions: PRODUCT_EMBEDDING_DIMENSIONS }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('products_id_shop_unique').on(t.id, t.shopId),
    check(
      'products_lowest_price_matches_mode',
      sql`(${t.pricingMode} = 'fixed' and ${t.lowestPrice} is null)
        or (${t.pricingMode} = 'negotiable' and ${t.lowestPrice} is not null and ${t.lowestPrice} <= ${t.price})`,
    ),
    shopIsolation(t.shopId),
  ],
);

export const productVariants = pgTable(
  'product_variants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: shopId(),
    productId: uuid('product_id').notNull(),
    size: text('size').notNull(),
    color: text('color'),
    stock: integer('stock').notNull(),
    reserved: integer('reserved').notNull().default(0),
  },
  (t) => [
    sameShopProduct(t),
    unique('product_variants_id_shop_unique').on(t.id, t.shopId),
    unique('product_variants_option_unique').on(t.productId, t.size, t.color).nullsNotDistinct(),
    check(
      'product_variants_stock_covers_reserved',
      sql`${t.reserved} >= 0 and ${t.reserved} <= ${t.stock}`,
    ),
    shopIsolation(t.shopId),
  ],
);

/** A product post in the shop's channel. Its ID goes into the Buy deep link. */
export const channelPosts = pgTable(
  'channel_posts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: shopId(),
    productId: uuid('product_id').notNull(),
    chatId: bigint('chat_id', { mode: 'number' }).notNull(),
    messageId: integer('message_id'),
    taps: integer('taps').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [sameShopProduct(t), shopIsolation(t.shopId)],
);
