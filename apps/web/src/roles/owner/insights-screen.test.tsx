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
  latitude: null,
  longitude: null,
  createdAt: '2026-11-01T08:00:00.000Z',
  paymentAccounts: [],
};
const insights = {
  days: 30,
  autoApprovedPayments: { count: 17, total: 20 },
  fraudBlocked: { count: 2, amount: '7000.00' },
  farQuotesDriverFound: { count: 0, total: 0 },
  delivery: { trips: 12, cost: '1450.00', saverSavings: '320.00' },
  guard: { accepted: 40, rejected: 6, needsOwner: 3 },
  posts: [
    {
      postId: '7b8c9d0e-1f2a-4b3c-8d4e-5f6a7b8c9d0e',
      productTitle: 'Nike Air',
      postedAt: '2026-11-01T08:00:00.000Z',
      taps: 25,
      paidOrders: 4,
    },
  ],
};

describe('insights screen', () => {
  it('shows the success metrics, and a dash where nothing was measured yet', async () => {
    fakeTelegram();
    fakeServer({
      'POST /auth/mini-app': session,
      [`GET /shops/${shopId}`]: () => json(200, shop),
      [`GET /shops/${shopId}/insights`]: () => json(200, insights),
    });
    renderAt(`/shops/${shopId}/insights`, <OwnerApp />);

    const approved = await screen.findByRole('region', { name: 'Payments approved without you' });
    expect(approved.textContent).toContain('85%');
    expect(approved.textContent).toContain('17 of 20');
    const fraud = screen.getByRole('region', { name: 'Fraud blocked' });
    expect(fraud.textContent).toContain('7,000.00 ብር');
    const far = screen.getByRole('region', { name: 'Far quotes with a driver in 10 minutes' });
    expect(far.textContent).toContain('—');
    const delivery = screen.getByRole('region', { name: 'Delivery cost' });
    expect(delivery.textContent).toContain('1,450.00 ብር');
    expect(delivery.textContent).toContain('saved 320.00 ብር');
    expect(screen.getByRole('region', { name: 'First reply time' }).textContent).toContain(
      'Not measured yet',
    );
    const row = screen.getByRole('row', { name: /Nike Air/ });
    expect(row.textContent).toContain('25');
    expect(row.textContent).toContain('4');
  });
});
