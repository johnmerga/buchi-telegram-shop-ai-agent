import { randomUUID } from 'node:crypto';
import type { CreateShopInput, PaymentAccount, ShopLocation } from '@buchi/shared';
import type { Database } from '../../db/client';
import { isUniqueViolation } from '../../db/errors';
import { withShop } from '../../db/with-shop';
import { AppError } from '../../shared/errors';
import type { ShopRow, ShopsRepo } from './shops.repo';

/** Confirms that the bot can post to a channel. Telegram is the only implementation. */
export interface ChannelVerifier {
  verifyPostingRights(channel: string): Promise<{ chatId: number; title: string }>;
}

export interface ShopDetails extends ShopRow {
  paymentAccounts: PaymentAccount[];
}

export class ShopsService {
  constructor(
    private readonly db: Database,
    private readonly repo: ShopsRepo,
    private readonly channels: ChannelVerifier,
  ) {}

  ownedShopIds(telegramUserId: number): Promise<string[]> {
    return this.repo.ownedShopIds(telegramUserId);
  }

  /** The new shop's ID becomes the row-level security context, so the insert passes its policy. */
  async create(ownerId: number, input: CreateShopInput): Promise<string> {
    const id = randomUUID();
    await withShop(this.db, id, (tx) => this.repo.insert(tx, { id, name: input.name, ownerId }));
    return id;
  }

  async listOwned(ownerId: number): Promise<ShopRow[]> {
    const shopIds = await this.repo.ownedShopIds(ownerId);
    const found = await Promise.all(
      shopIds.map((shopId) => withShop(this.db, shopId, (tx) => this.repo.find(tx, shopId))),
    );
    return found.filter((shop) => shop !== undefined);
  }

  get(shopId: string): Promise<ShopDetails> {
    return withShop(this.db, shopId, async (tx) => {
      const shop = await this.repo.find(tx, shopId);
      if (!shop) throw new AppError('NOT_FOUND', 'Shop not found');
      return { ...shop, paymentAccounts: await this.repo.listPaymentAccounts(tx) };
    });
  }

  async setLocation(shopId: string, location: ShopLocation): Promise<void> {
    await withShop(this.db, shopId, (tx) => this.repo.setLocation(tx, shopId, location));
  }

  async setPaymentAccounts(shopId: string, accounts: PaymentAccount[]): Promise<void> {
    await withShop(this.db, shopId, (tx) => this.repo.replacePaymentAccounts(tx, shopId, accounts));
  }

  async connectChannel(shopId: string, channel: string): Promise<{ title: string }> {
    const verified = await this.channels.verifyPostingRights(channel);
    try {
      await withShop(this.db, shopId, (tx) => this.repo.setChannel(tx, shopId, verified));
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new AppError('CONFLICT', 'This channel is already connected to another shop');
      }
      throw err;
    }
    return { title: verified.title };
  }
}
