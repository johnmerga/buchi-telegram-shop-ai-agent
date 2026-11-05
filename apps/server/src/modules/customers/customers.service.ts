import type { Database } from '../../db/client';
import { withShop } from '../../db/with-shop';
import { AppError } from '../../shared/errors';
import type { CustomerRow, CustomersRepo } from './customers.repo';
import type { CustomerSession, SessionsRepo } from './sessions.repo';

export class CustomersService {
  constructor(
    private readonly db: Database,
    private readonly repo: CustomersRepo,
    private readonly sessions: SessionsRepo,
  ) {}

  /** Points the customer's chat at the shop whose Buy link they tapped. */
  startSession(telegramUserId: number, shopId: string): Promise<void> {
    return this.sessions.start(telegramUserId, shopId);
  }

  sessionOf(telegramUserId: number): Promise<CustomerSession | undefined> {
    return this.sessions.find(telegramUserId);
  }

  rememberChosenVariant(telegramUserId: number, variantId: string | null): Promise<void> {
    return this.sessions.setPendingVariant(telegramUserId, variantId);
  }

  identify(shopId: string, telegramUserId: number, name: string): Promise<CustomerRow> {
    return withShop(this.db, shopId, (tx) =>
      this.repo.upsert(tx, { shopId, telegramUserId, name }),
    );
  }

  async setPhone(shopId: string, customerId: string, phone: string): Promise<void> {
    await withShop(this.db, shopId, (tx) => this.repo.setPhone(tx, customerId, phone));
  }

  async get(shopId: string, customerId: string): Promise<CustomerRow> {
    const customer = await withShop(this.db, shopId, (tx) => this.repo.find(tx, customerId));
    if (!customer) throw new AppError('NOT_FOUND', 'Customer not found');
    return customer;
  }

  /** The customer's private chat with the bot has the same ID as their Telegram user. */
  async telegramUserId(shopId: string, customerId: string): Promise<number> {
    const id = await withShop(this.db, shopId, (tx) => this.repo.telegramUserId(tx, customerId));
    if (id === undefined) throw new AppError('NOT_FOUND', 'Customer not found');
    return id;
  }
}
