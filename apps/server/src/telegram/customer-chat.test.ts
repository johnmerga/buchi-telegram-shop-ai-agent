import { Api } from 'grammy';
import { describe, expect, it } from 'vitest';
import { TelegramCustomerChat } from './customer-chat';
import { MiniAppLinks } from './mini-app-links';

const orderId = '3d6f0a2b-1c4e-4b5a-8d7c-9e0f1a2b3c4d';

function recordingApi(): { api: Api; payloads: Record<string, unknown>[] } {
  const api = new Api('test');
  const payloads: Record<string, unknown>[] = [];
  api.config.use((_prev, _method, payload) => {
    payloads.push({ ...payload });
    // The chat only needs a successful reply; the message itself is never read back.
    return Promise.resolve({ ok: true, result: { message_id: 1 } } as never);
  });
  return { api, payloads };
}

describe('TelegramCustomerChat with Mini App links', () => {
  const links = new MiniAppLinks('https://buchi.example.com');

  it('adds a Track order button to the payment instructions', async () => {
    const { api, payloads } = recordingApi();
    await new TelegramCustomerChat(api, links).orderStep(1, {
      status: 'placed',
      orderId,
      instructions: 'Pay 100 birr',
    });
    expect(payloads[0]?.reply_markup).toEqual({
      inline_keyboard: [
        [
          {
            text: '📦 ትዕዛዜ / Track order',
            web_app: { url: `https://buchi.example.com/customer/orders/${orderId}` },
          },
        ],
      ],
    });
  });

  it('opens the map picker at a suggested place', async () => {
    const { api, payloads } = recordingApi();
    await new TelegramCustomerChat(api, links).askForPin(1, 'Where?', {
      latitude: 9.005,
      longitude: 38.79,
    });
    expect(JSON.stringify(payloads[0]?.reply_markup)).toContain(
      'https://buchi.example.com/customer/pin?lat=9.005&lng=38.79',
    );
  });

  it('offers only the plain location button without a web app URL', async () => {
    const { api, payloads } = recordingApi();
    await new TelegramCustomerChat(api).askForPin(1, 'Where?');
    expect(JSON.stringify(payloads[0]?.reply_markup)).not.toContain('web_app');
  });
});
