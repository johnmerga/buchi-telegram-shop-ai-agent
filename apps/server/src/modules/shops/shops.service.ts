import type { ShopsRepo } from './shops.repo';

export class ShopsService {
  constructor(private readonly repo: ShopsRepo) {}

  ownedShopIds(telegramUserId: number): Promise<string[]> {
    return this.repo.ownedShopIds(telegramUserId);
  }
}
