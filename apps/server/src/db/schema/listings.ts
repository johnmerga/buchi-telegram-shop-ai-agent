import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { pricingMode } from './catalog';
import { shopIsolation } from './rls';
import { shops } from './shops';

export const listingDraftStatus = pgEnum('listing_draft_status', ['draft', 'posted', 'discarded']);

const money = (name: string) => numeric(name, { precision: 12, scale: 2 });

/**
 * A product drafted from the owner's photos and short text, waiting for **Post**, **Edit**, or
 * **Discard**. Prices come only from what the owner wrote, never from the model.
 */
export const listingDrafts = pgTable(
  'listing_drafts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    ownerText: text('owner_text').notNull(),
    photoFileIds: text('photo_file_ids').array().notNull(),
    /** Telegram's album ID, so the other photos of the same album join this draft. */
    mediaGroupId: text('media_group_id'),
    /** The model's draft: titles, descriptions, category, colors, and sizes. */
    draft: jsonb('draft').$type<Record<string, unknown>>().notNull(),
    pricingMode: pricingMode('pricing_mode').notNull(),
    price: money('price'),
    lowestPrice: money('lowest_price'),
    stockPerSize: integer('stock_per_size').notNull(),
    status: listingDraftStatus('status').notNull().default('draft'),
    /** The draft message with the buttons, which the owner replies to with changes. */
    previewChatId: bigint('preview_chat_id', { mode: 'number' }),
    previewMessageId: integer('preview_message_id'),
    productId: uuid('product_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'listing_drafts_prices_match_mode',
      sql`(${t.pricingMode} = 'fixed' and ${t.lowestPrice} is null)
        or (${t.pricingMode} = 'negotiable' and (${t.lowestPrice} is null) = (${t.price} is null))`,
    ),
    check('listing_drafts_stock_positive', sql`${t.stockPerSize} > 0`),
    shopIsolation(t.shopId),
  ],
);
