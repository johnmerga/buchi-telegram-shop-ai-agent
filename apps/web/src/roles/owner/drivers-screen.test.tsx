import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fakeServer, fakeTelegram, json, renderAt, session } from '../../test/fakes';
import { OwnerApp } from './owner-app';

const shopId = '6f1c2a4e-8b3d-4f5a-9c7e-1d2b3a4c5e6f';
const shop = {
  id: shopId,
  name: 'Selam Shoes',
  channelChatId: null,
  channelTitle: null,
  latitude: 9.0108,
  longitude: 38.7613,
  createdAt: '2026-11-01T08:00:00.000Z',
  paymentAccounts: [],
};
const driver = (id: string, name: string, work: unknown) => ({
  id,
  username: name.toLowerCase(),
  name,
  linked: true,
  available: true,
  inviteExpiresAt: null,
  work,
});

describe('drivers screen', () => {
  it('shows beside each duty switch what the driver is doing now', async () => {
    fakeTelegram();
    fakeServer({
      'POST /auth/mini-app': session,
      [`GET /shops/${shopId}`]: () => json(200, shop),
      [`GET /shops/${shopId}/drivers`]: () =>
        json(200, [
          driver('1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e', 'Abebe', {
            stage: 'delivering',
            orderReference: '#3F0059',
          }),
          driver('2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f', 'Kebede', {
            stage: 'to_pickup',
            orderReference: '#7B1D4E',
          }),
          driver('3d4e5f6a-7b8c-4d9e-8f0a-2b3c4d5e6f7a', 'Tsion', null),
        ]),
    });
    renderAt(`/shops/${shopId}/drivers`, <OwnerApp />);

    expect(await screen.findByText('Delivering #3F0059')).toBeTruthy();
    expect(screen.getByText('Heading to the shop for #7B1D4E')).toBeTruthy();
    expect(screen.getByText('Free')).toBeTruthy();
    expect(screen.getAllByText('On duty')).toHaveLength(3);
    expect(screen.getByText(/switched themselves on for work/)).toBeTruthy();
  });
});
