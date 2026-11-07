import { describe, expect, it, vi } from 'vitest';
import { demoTelegramId } from '../shared/demo-ids';
import { skipDemoRecipients } from './demo-recipients';

describe('skipDemoRecipients', () => {
  const logger = { info: vi.fn() };
  const prev = vi.fn(() => Promise.resolve({ ok: true as const, result: true as never }));
  const guard = skipDemoRecipients(logger);

  it('never calls Telegram for a demo person, and answers like a sent message', async () => {
    const answer = await guard(prev, 'sendMessage', { chat_id: demoTelegramId(7), text: 'Hi' });
    expect(prev).not.toHaveBeenCalled();
    expect(answer).toMatchObject({ ok: true, result: { message_id: 0 } });
  });

  it('passes every other call through', async () => {
    await guard(prev, 'sendMessage', { chat_id: 642958169, text: 'Hi' });
    await guard(prev, 'getMe', undefined as never);
    expect(prev).toHaveBeenCalledTimes(2);
  });
});
