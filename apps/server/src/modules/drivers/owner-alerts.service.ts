import type { Logger } from 'pino';
import type { Button } from '../owner/owner.domain';
import type { Messenger } from '../owner/owner-notifier.service';
import type { ShopsService } from '../shops/shops.service';

/** Sends a shop's owners an alert about its deliveries. */
export class DeliveryOwnerAlerts {
  constructor(
    private readonly shops: Pick<ShopsService, 'get' | 'ownerIds'>,
    private readonly messenger: Pick<Messenger, 'send'>,
    private readonly logger: Logger,
  ) {}

  /** One owner who blocked the bot does not stop the others. */
  async send(shopId: string, text: string, buttons: Button[] = []): Promise<void> {
    const [shop, ownerIds] = await Promise.all([
      this.shops.get(shopId),
      this.shops.ownerIds(shopId),
    ]);
    for (const ownerId of ownerIds) {
      try {
        await this.messenger.send(ownerId, `🛵 ${shop.name}\n${text}`, buttons);
      } catch (err) {
        // Only the message: a Telegram error object also holds the request with its text.
        const reason = err instanceof Error ? err.message : 'unknown error';
        this.logger.error({ shopId, reason }, 'delivery alert failed');
      }
    }
  }
}
