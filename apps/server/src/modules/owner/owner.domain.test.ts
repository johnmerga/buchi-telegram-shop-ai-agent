import { describe, expect, it } from 'vitest';
import {
  appendTurns,
  currentTurns,
  handBackTime,
  humanRequestAlert,
  modeButton,
  orderAlert,
  ownerMessageHeader,
} from './owner.domain';

const id = '3f2a9c00-0000-4000-8000-000000000001';

describe('handBackTime', () => {
  it('is two hours after the last owner activity', () => {
    expect(handBackTime(new Date('2026-11-05T12:00:00Z'))).toEqual(
      new Date('2026-11-05T14:00:00Z'),
    );
  });
});

describe('modeButton', () => {
  it('offers Take over while Buchi answers', () => {
    expect(modeButton({ id, mode: 'agent' })).toEqual({
      text: '🙋 ተረከብ / Take over',
      data: `takeover:${id}`,
    });
  });

  it('offers Hand back while an owner answers', () => {
    expect(modeButton({ id, mode: 'human' })).toEqual({
      text: '↩️ መልስ / Hand back',
      data: `handback:${id}`,
    });
  });

  it('fits Telegram’s 64-byte limit for button data', () => {
    expect(Buffer.byteLength(modeButton({ id, mode: 'agent' }).data)).toBeLessThanOrEqual(64);
  });
});

describe('ownerMessageHeader', () => {
  it('names the customer and the shop', () => {
    expect(ownerMessageHeader('Hana', 'Selam Shoes')).toBe('💬 Hana · Selam Shoes');
  });
});

describe('orderAlert', () => {
  it('lists the reference, each item, and the total', () => {
    const text = orderAlert({
      orderId: id,
      total: '9500.00',
      lines: [
        { title: 'Nike Air Force 1', size: '42', quantity: 1 },
        { title: 'Puma Suede', size: '40', quantity: 2 },
      ],
    });
    expect(text).toContain('#3F2A9C');
    expect(text).toContain('Nike Air Force 1 · መጠን / size 42\n');
    expect(text).toContain('Puma Suede · መጠን / size 40 × 2');
    expect(text).toContain('9,500.00 ብር');
  });
});

describe('humanRequestAlert', () => {
  it('gives the reason and tells the owner how to answer', () => {
    const alert = humanRequestAlert('The customer asked for a person.');
    expect(alert).toContain('Needs you: The customer asked for a person.');
    expect(alert).toContain('Reply to this message to answer.');
  });
});

describe('conversation turns', () => {
  const now = new Date('2026-11-05T12:00:00Z');
  const turn = (text: string, at: string) => ({ text, at });

  it('forgets turns older than a day', () => {
    const turns = [turn('old', '2026-11-04T11:59:59Z'), turn('recent', '2026-11-04T12:00:00Z')];
    expect(currentTurns(turns, now).map((t) => t.text)).toEqual(['recent']);
  });

  it('keeps the latest twelve turns', () => {
    const earlier = Array.from({ length: 12 }, (_, i) => turn(`t${String(i)}`, now.toISOString()));
    const kept = appendTurns(earlier, [turn('new', now.toISOString())], now);
    expect(kept).toHaveLength(12);
    expect(kept[0]?.text).toBe('t1');
    expect(kept.at(-1)?.text).toBe('new');
  });
});
