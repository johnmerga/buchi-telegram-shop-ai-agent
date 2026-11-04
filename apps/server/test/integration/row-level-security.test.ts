import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectDatabase } from '../../src/db/client';
import { shopMembers, shops } from '../../src/db/schema';
import { withShop } from '../../src/db/with-shop';
import { testDatabaseUrl } from './test-database';

const { db, close } = connectDatabase(testDatabaseUrl);
const shopA = '00000000-0000-4000-8000-00000000000a';
const shopB = '00000000-0000-4000-8000-00000000000b';
/** Postgres reports a row-level security violation with this SQLSTATE. */
const insufficientPrivilege = '42501';

beforeAll(async () => {
  await db.insert(shops).values([
    { id: shopA, name: 'Shop A' },
    { id: shopB, name: 'Shop B' },
  ]);
  await db.insert(shopMembers).values([
    { shopId: shopA, telegramUserId: 1001 },
    { shopId: shopB, telegramUserId: 2002 },
  ]);
});

afterAll(close);

describe('row-level security', () => {
  it('protects every shop-owned table with a policy', async () => {
    const rows = await db.execute<{ table_name: string; protected: boolean }>(sql`
      select c.relname as table_name,
             c.relrowsecurity and exists (
               select 1 from pg_policy p where p.polrelid = c.oid
             ) as protected
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
        and (c.relname = 'shops' or exists (
          select 1 from information_schema.columns col
          where col.table_schema = 'public' and col.table_name = c.relname
            and col.column_name = 'shop_id'
        ))`);

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row, row.table_name).toMatchObject({ protected: true });
    }
  });

  it("shows only the current shop's rows", async () => {
    const visible = await withShop(db, shopA, async (tx) => ({
      shops: await tx.select().from(shops),
      members: await tx.select().from(shopMembers),
    }));

    expect(visible.shops.map((s) => s.id)).toEqual([shopA]);
    expect(visible.members.map((m) => m.shopId)).toEqual([shopA]);
  });

  it("rejects writes into another shop's rows", async () => {
    await expect(
      withShop(db, shopA, (tx) =>
        tx.insert(shopMembers).values({ shopId: shopB, telegramUserId: 3003 }),
      ),
    ).rejects.toMatchObject({ cause: { code: insufficientPrivilege } });
  });

  it('shows nothing when no shop is set', async () => {
    const visible = await db.transaction(async (tx) => {
      await tx.execute(sql`set local role app_user`);
      return tx.select().from(shops);
    });
    expect(visible).toEqual([]);
  });
});
