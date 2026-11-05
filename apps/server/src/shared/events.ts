import type { MoneyString, OrderStatus } from '@buchi/shared';
import type { Logger } from 'pino';

/** Every domain event and its payload. Events are published after their transaction commits. */
export interface DomainEvents {
  'order.created': { shopId: string; orderId: string };
  'order.transitioned': { shopId: string; orderId: string; from: OrderStatus; to: OrderStatus };
  /** A driver holds the special offer for a far-area order at `price`, after `raises` raises. */
  'delivery.offer_held': { shopId: string; orderId: string; price: MoneyString; raises: number };
}

type Handler<K extends keyof DomainEvents> = (payload: DomainEvents[K]) => Promise<void>;

/**
 * An in-process publish and subscribe bus. One Render instance runs Buchi, so no broker is needed.
 * A failing subscriber is logged and does not affect the publisher or the other subscribers.
 */
export class EventBus {
  private readonly handlers = new Map<keyof DomainEvents, Handler<keyof DomainEvents>[]>();

  constructor(private readonly logger: Logger) {}

  subscribe<K extends keyof DomainEvents>(event: K, handler: Handler<K>): void {
    const existing = this.handlers.get(event) ?? [];
    // The map stores handlers under their own event name, so each one only receives its payload.
    this.handlers.set(event, [...existing, handler as Handler<keyof DomainEvents>]);
  }

  async publish<K extends keyof DomainEvents>(event: K, payload: DomainEvents[K]): Promise<void> {
    for (const handler of this.handlers.get(event) ?? []) {
      try {
        await handler(payload);
      } catch (err) {
        this.logger.error({ err, event }, 'event subscriber failed');
      }
    }
  }
}
