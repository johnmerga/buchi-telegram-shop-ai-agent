import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { EventBus } from './events';

const payload = { shopId: 's', orderId: 'o' };

describe('EventBus', () => {
  it('delivers an event to every subscriber, even after one fails', async () => {
    const bus = new EventBus(pino({ level: 'silent' }));
    const received: string[] = [];
    bus.subscribe('order.created', () => Promise.reject(new Error('boom')));
    bus.subscribe('order.created', (event) => {
      received.push(event.orderId);
      return Promise.resolve();
    });

    await bus.publish('order.created', payload);

    expect(received).toEqual(['o']);
  });

  it('does nothing for an event without subscribers', async () => {
    await expect(
      new EventBus(pino({ level: 'silent' })).publish('order.created', payload),
    ).resolves.toBeUndefined();
  });
});
