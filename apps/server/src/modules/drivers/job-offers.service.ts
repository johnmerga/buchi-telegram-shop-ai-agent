import type { Logger } from 'pino';
import type { MoneyString } from '@buchi/shared';
import type { Database, Transaction } from '../../db/client';
import { withShop } from '../../db/with-shop';
import type { MessageRef, Messenger } from '../owner/owner-notifier.service';
import type { ShopsService } from '../shops/shops.service';
import type { DeliveryJobsRepo, OfferRow } from './delivery-jobs.repo';
import { offerText } from './dispatch-messages.domain';
import { ACCEPT_WINDOW_MS } from './dispatch.domain';
import type { DriversRepo } from './drivers.repo';
import { jobCallbackData } from './drivers.schemas';

export const OFFER_UNANSWERED_TIMER = 'drivers.offer_unanswered';

interface TimerScheduler {
  schedule(
    tx: Transaction,
    kind: string,
    targetId: string,
    shopId: string | null,
    dueAt: Date,
  ): Promise<unknown>;
}

/**
 * Opens job offers and carries them to drivers' chats, and changes those messages once an offer
 * closes.
 */
export class JobOffers {
  constructor(
    private readonly db: Database,
    private readonly jobs: DeliveryJobsRepo,
    private readonly drivers: DriversRepo,
    private readonly shops: Pick<ShopsService, 'get'>,
    private readonly messenger: Pick<Messenger, 'send' | 'edit'>,
    private readonly timers: TimerScheduler,
    private readonly logger: Logger,
    private readonly now: () => Date,
  ) {}

  /** Opens an offer with its 10-minute timer in the caller's transaction. */
  async open(
    tx: Transaction,
    offer: { shopId: string; jobId: string; price: MoneyString; raiseStep: number },
  ): Promise<OfferRow> {
    const row = await this.jobs.insertOffer(tx, offer);
    const dueAt = new Date(this.now().getTime() + ACCEPT_WINDOW_MS);
    await this.timers.schedule(tx, OFFER_UNANSWERED_TIMER, row.id, offer.shopId, dueAt);
    return row;
  }

  /** Sends the offer to every available driver and remembers each message. Failures are logged. */
  async broadcast(shopId: string, offer: OfferRow): Promise<void> {
    const [shop, { job, stops, drivers }] = await Promise.all([
      this.shops.get(shopId),
      withShop(this.db, shopId, async (tx) => ({
        job: await this.jobs.findJob(tx, offer.jobId),
        stops: await this.jobs.stops(tx, offer.jobId),
        drivers: await this.drivers.available(tx),
      })),
    ]);
    if (!job) throw new Error('An offer has no delivery job');
    const text = offerText({
      special: job.special,
      shopName: shop.name,
      stops: stops.length,
      routeMeters: job.routeMeters,
      estimatedMinutes: job.estimatedMinutes,
      price: offer.price,
      raiseStep: offer.raiseStep,
    });
    // A special offer's accept only holds the job until the customer pays.
    const action = job.special ? 'hold' : 'accept';
    const buttons = [{ text: '✅ Accept / እቀበላለሁ', data: jobCallbackData(action, offer.id) }];

    const sent: MessageRef[] = [];
    for (const driver of drivers) {
      try {
        const messageId = await this.messenger.send(driver.telegramUserId, text, buttons);
        sent.push({ chatId: driver.telegramUserId, messageId });
      } catch (err) {
        this.logFailure(shopId, err, 'job offer failed');
      }
    }
    await withShop(this.db, shopId, (tx) =>
      this.jobs.recordOfferMessages(tx, shopId, offer.id, sent),
    );
  }

  /** Replaces the offer's message in every driver's chat except `exceptChatId`. */
  async close(
    shopId: string,
    offerId: string,
    notice: string,
    exceptChatId?: number,
  ): Promise<void> {
    const messages = await withShop(this.db, shopId, (tx) => this.jobs.offerMessages(tx, offerId));
    await this.closeMessages(
      shopId,
      messages.filter((message) => message.chatId !== exceptChatId),
      notice,
    );
  }

  /** Replaces offer messages that were read before their offer was deleted. */
  async closeMessages(shopId: string, messages: MessageRef[], notice: string): Promise<void> {
    for (const message of messages) {
      try {
        await this.messenger.edit(message, notice, []);
      } catch (err) {
        this.logFailure(shopId, err, 'closing a job offer failed');
      }
    }
  }

  /** Only the message: a Telegram error object also holds the request with its text. */
  private logFailure(shopId: string, err: unknown, what: string): void {
    const reason = err instanceof Error ? err.message : 'unknown error';
    this.logger.error({ shopId, reason }, what);
  }
}
