import { sql } from 'drizzle-orm';
import { bigint, check, index, jsonb, pgEnum, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { shopIsolation } from './rls';
import { shops } from './shops';

export const ownerRuleType = pgEnum('owner_rule_type', [
  'delivery_pause',
  'promotion',
  'delivery_settings',
]);

/**
 * A rule the owner confirmed from a preview. Code enforces each type in the service it affects:
 * a pause in delivery options, a promotion in prices. `parameters` holds the type's own fields.
 */
export const ownerRules = pgTable(
  'owner_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: uuid('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    type: ownerRuleType('type').notNull(),
    parameters: jsonb('parameters').$type<Record<string, unknown>>().notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    /** Null for a rule without an end, such as a settings change. */
    endsAt: timestamp('ends_at', { withTimezone: true }),
    /** The owner who tapped **Confirm**. */
    confirmedBy: bigint('confirmed_by', { mode: 'number' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('owner_rules_period', sql`${t.endsAt} is null or ${t.endsAt} > ${t.startsAt}`),
    index('owner_rules_active_idx').on(t.shopId, t.type, t.startsAt),
    shopIsolation(t.shopId),
  ],
);
