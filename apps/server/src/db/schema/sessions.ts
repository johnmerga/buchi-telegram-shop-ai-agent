import { bigint, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { products, productVariants } from './catalog';
import { shops } from './shops';

/**
 * The shop that a customer's private chat with the shared bot is about, set by the last Buy link
 * they tapped. Platform-wide, because it is read before any shop is known. It holds no personal data.
 */
export const customerSessions = pgTable('customer_sessions', {
  telegramUserId: bigint('telegram_user_id', { mode: 'number' }).primaryKey(),
  shopId: uuid('shop_id')
    .notNull()
    .references(() => shops.id, { onDelete: 'cascade' }),
  /** The product whose Buy link the customer tapped, so the sales agent knows what "this" is. */
  productId: uuid('product_id').references(() => products.id, { onDelete: 'set null' }),
  /** The size a customer chose before sharing their phone number. */
  pendingVariantId: uuid('pending_variant_id').references(() => productVariants.id, {
    onDelete: 'set null',
  }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
