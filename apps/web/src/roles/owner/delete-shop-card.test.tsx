import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fakeServer, fakeTelegram, json, renderAt, session } from '../../test/fakes';
import { OwnerApp } from './owner-app';

const shopId = '6f1c2a4e-8b3d-4f5a-9c7e-1d2b3a4c5e6f';
const shop = {
  id: shopId,
  name: 'Selam Shoes',
  channelChatId: null,
  channelTitle: null,
  latitude: null,
  longitude: null,
  createdAt: '2026-11-01T08:00:00.000Z',
  paymentAccounts: [],
};
const unavailable = () =>
  json(503, { error: { code: 'UNAVAILABLE', message: 'Not in this test' } });

function showSettings() {
  fakeTelegram();
  let shops = [shop];
  const server = fakeServer({
    'POST /auth/mini-app': session,
    'GET /shops': () => json(200, shops),
    [`GET /shops/${shopId}`]: () => json(200, shop),
    [`GET /shops/${shopId}/delivery-settings`]: unavailable,
    [`GET /shops/${shopId}/ledger`]: unavailable,
    [`DELETE /shops/${shopId}`]: () => {
      shops = [];
      return new Response(null, { status: 204 });
    },
  });
  renderAt(`/shops/${shopId}/settings`, <OwnerApp />);
  return server;
}

describe('deleting a shop', () => {
  it('waits for the exact name, then deletes the shop and goes back to the shop list', async () => {
    const { calls } = showSettings();
    const button = await screen.findByRole('button', { name: 'Delete this shop' });
    const confirm = screen.getByLabelText("Type the shop's name to confirm");
    expect(button).toHaveProperty('disabled', true);

    fireEvent.change(confirm, { target: { value: 'Selam' } });
    expect(button).toHaveProperty('disabled', true);

    fireEvent.change(confirm, { target: { value: 'Selam Shoes' } });
    expect(button).toHaveProperty('disabled', false);
    fireEvent.click(button);

    expect(await screen.findByText('Open your shop · ሱቅ ይክፈቱ')).toBeTruthy();
    const removal = calls.find((call) => call.key === `DELETE /shops/${shopId}`);
    expect(removal?.init?.body).toBe(JSON.stringify({ name: 'Selam Shoes' }));
  });
});
