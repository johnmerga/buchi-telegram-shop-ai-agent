import type { Update } from 'grammy/types';
import { describe, expect, it } from 'vitest';
import { createBot } from './bot';

const botInfo = {
  id: 1,
  is_bot: true as const,
  first_name: 'Buchi',
  username: 'buchi_test_bot',
  can_join_groups: false,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
  has_topics_enabled: false,
  allows_users_to_create_topics: false,
};

const start = (fromId: number): Update => ({
  update_id: 1,
  message: {
    message_id: 1,
    date: 0,
    chat: { id: fromId, type: 'private', first_name: 'Test' },
    from: { id: fromId, is_bot: false, first_name: 'Test' },
    text: '/start',
    entities: [{ type: 'bot_command', offset: 0, length: 6 }],
  },
});

async function replyTo(fromId: number, ownedShopIds: string[]): Promise<string> {
  const bot = createBot({
    token: 'test',
    botInfo,
    ownedShopIds: () => Promise.resolve(ownedShopIds),
  });
  const sent: string[] = [];
  bot.api.config.use((_prev, method, payload) => {
    if (method === 'sendMessage' && 'text' in payload) sent.push(payload.text);
    return Promise.resolve({ ok: true, result: true } as never);
  });
  await bot.handleUpdate(start(fromId));
  return sent.join('\n');
}

describe('createBot', () => {
  it('greets a customer', async () => {
    expect(await replyTo(10, [])).toContain('Tap Buy');
  });

  it('recognizes a shop owner by Telegram user ID', async () => {
    expect(await replyTo(20, ['shop-1'])).toContain('Welcome back');
  });
});
