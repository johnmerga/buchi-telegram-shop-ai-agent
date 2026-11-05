import type { Logger } from 'pino';
import type { Database, Transaction } from '../../db/client';
import { withShop } from '../../db/with-shop';
import type { CustomersService } from '../customers/customers.service';
import type { TripService } from '../drivers/trips.service';
import type { OrderService } from '../orders/orders.service';
import type { ConversationService } from '../owner/conversations.service';
import type { Messenger } from '../owner/owner-notifier.service';
import type { CustomerMessages } from './customer-messages.service';
import { rescheduledForCustomer, rescheduledForDriver } from './operations.domain';

/** Moves the order unless its customer writes first. The target is the order. */
export const RESCHEDULE_TIMER = 'operations.reschedule_if_silent';

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
 * Moves an order that could not be delivered to the next Saver run. The wait for the customer
 * is a code timer, so the agent is not woken again to decide.
 */
export class DeliveryRescheduler {
  constructor(
    private readonly db: Database,
    private readonly orders: Pick<OrderService, 'get' | 'reschedule'>,
    private readonly customers: Pick<CustomersService, 'get'>,
    private readonly trips: Pick<TripService, 'dropStop'>,
    private readonly conversations: Pick<ConversationService, 'recentTurns'>,
    private readonly customerMessages: Pick<CustomerMessages, 'toOrderCustomer'>,
    private readonly messenger: Pick<Messenger, 'send'>,
    private readonly timers: TimerScheduler,
    private readonly logger: Logger,
    private readonly now: () => Date,
  ) {}

  /** Moves the order now, or after `waitMinutes` unless the customer writes in the meantime. */
  async reschedule(shopId: string, orderId: string, waitMinutes: number): Promise<Date> {
    const at = new Date(this.now().getTime() + waitMinutes * 60_000);
    if (waitMinutes === 0) {
      await this.move(shopId, orderId);
    } else {
      await withShop(this.db, shopId, (tx) =>
        this.timers.schedule(tx, RESCHEDULE_TIMER, orderId, shopId, at),
      );
    }
    return at;
  }

  /** The timer handler. An order that was delivered or moved meanwhile is left alone. */
  async rescheduleIfSilent(timer: {
    targetId: string;
    shopId: string | null;
    createdAt: Date;
  }): Promise<void> {
    const { shopId, targetId } = timer;
    if (shopId === null) throw new Error('A reschedule timer needs a shop');
    const order = await this.orders.get(shopId, targetId);
    if (order.status !== 'out_for_delivery') return;
    const customer = await this.customers.get(shopId, order.customerId);
    const turns = await this.conversations.recentTurns(shopId, customer);
    const replied = turns.some(
      (turn) => turn.role === 'customer' && Date.parse(turn.at) >= timer.createdAt.getTime(),
    );
    if (!replied) await this.move(shopId, targetId);
  }

  private async move(shopId: string, orderId: string): Promise<void> {
    await this.orders.reschedule(shopId, orderId, 'The customer could not be reached');
    const dropped = await this.trips.dropStop(shopId, orderId);
    if (dropped) await this.tellDriver(shopId, dropped.driverChatId, orderId);
    await this.customerMessages.toOrderCustomer(shopId, orderId, rescheduledForCustomer(orderId));
  }

  /** A driver who blocked the bot still has the order taken off their trip. */
  private async tellDriver(shopId: string, chatId: number, orderId: string): Promise<void> {
    try {
      await this.messenger.send(chatId, rescheduledForDriver(orderId), []);
    } catch (err) {
      // Only the message: a Telegram error object also holds the request with its text.
      const reason = err instanceof Error ? err.message : 'unknown error';
      this.logger.error({ shopId, reason }, 'reschedule message failed');
    }
  }
}
