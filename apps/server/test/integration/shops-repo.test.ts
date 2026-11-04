import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectDatabase } from '../../src/db/client';
import { shopMembers, shops } from '../../src/db/schema';
import { ShopsRepo } from '../../src/modules/shops/shops.repo';
import { testDatabaseUrl } from './test-database';

const { db, close } = connectDatabase(testDatabaseUrl);
const shopId = '00000000-0000-4000-8000-0000000000c1';
const ownerId = 777001;

beforeAll(async () => {
  await db.insert(shops).values({ id: shopId, name: 'Owner lookup shop' });
  await db.insert(shopMembers).values({ shopId, telegramUserId: ownerId });
});

afterAll(close);

describe('ShopsRepo.ownedShopIds', () => {
  it("finds an owner's shops even as app_user with no shop selected", async () => {
    const shopIds = await db.transaction(async (tx) => {
      await tx.execute(sql`set local role app_user`);
      return new ShopsRepo(tx).ownedShopIds(ownerId);
    });
    expect(shopIds).toEqual([shopId]);
  });

  it('returns nothing for someone who owns no shop', async () => {
    expect(await new ShopsRepo(db).ownedShopIds(123)).toEqual([]);
  });
});
