import { sql, type AnyColumn } from 'drizzle-orm';
import { pgPolicy, pgRole } from 'drizzle-orm/pg-core';

/** The role that application queries run as. It cannot bypass row-level security. */
export const appUser = pgRole('app_user').existing();

const currentShopId = sql`nullif(current_setting('app.shop_id', true), '')::uuid`;

/** Lets the current request see and write only the rows of the shop set by `withShop`. */
export function shopIsolation(shopIdColumn: AnyColumn) {
  const sameShop = sql`${shopIdColumn} = ${currentShopId}`;
  return pgPolicy('shop_isolation', {
    for: 'all',
    to: appUser,
    using: sameShop,
    withCheck: sameShop,
  });
}
