import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { fakeServer, fakeTelegram, json, renderAt, session } from '../../test/fakes';
import { OwnerApp } from './owner-app';

// Stands for a map that cannot load, such as Leaflet's bundle on a dropped connection.
vi.mock('../../components/map/routes-map', () => ({
  default: () => {
    throw new Error('Leaflet failed to load');
  },
}));

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
const deliveries = {
  shopPin: { latitude: 9.0108, longitude: 38.7613 },
  jobs: [
    {
      jobId: '7b8c9d0e-1f2a-4b3c-8d4e-5f6a7b8c9d0e',
      status: 'picked_up',
      far: false,
      payout: '180.00',
      driverName: 'Dawit',
      stops: [],
    },
  ],
};

describe('deliveries screen', () => {
  it('still lists the deliveries when the map cannot load', async () => {
    // React logs every error that a boundary catches.
    const reactLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    fakeTelegram();
    fakeServer({
      'POST /auth/mini-app': session,
      [`GET /shops/${shopId}`]: () => json(200, shop),
      [`GET /shops/${shopId}/deliveries`]: () => json(200, deliveries),
    });
    renderAt(`/shops/${shopId}/deliveries`, <OwnerApp />);

    expect((await screen.findByRole('alert')).textContent).toContain('The map could not load');
    expect(screen.getByText('On the way to customers')).toBeTruthy();
    expect(screen.getByText(/Dawit/)).toBeTruthy();
    reactLog.mockRestore();
  });
});
