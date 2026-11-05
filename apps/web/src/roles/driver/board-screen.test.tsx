import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeServer, fakeTelegram, json, renderAt, session } from '../../test/fakes';
import { DriverApp } from './driver-app';

const offerId = '0b9d8c7a-6e5f-4a3b-9c2d-1e0f9a8b7c6d';
const board = {
  offers: [
    {
      offerId,
      shopName: 'Selam Shoes',
      price: '160.00',
      special: true,
      stops: 1,
      routeMeters: 5200,
      estimatedMinutes: 18,
    },
  ],
  trips: [],
  earnings: [{ shopName: 'Selam Shoes', deliveredTrips: 3, payout: '480.00' }],
};

describe('driver Mini App', () => {
  it('shows special offers and payouts, and accepts an offer', async () => {
    fakeTelegram();
    const { calls } = fakeServer({
      'POST /auth/mini-app': session,
      'GET /driver/board': () => json(200, board),
      [`POST /driver/offers/${offerId}/accept`]: () => json(200, { result: 'accepted' }),
    });
    renderAt('/', <DriverApp />);

    const offers = await screen.findByRole('region', { name: 'Special offers' });
    expect(offers.textContent).toContain('160.00 ብር');
    expect(offers.textContent).toContain('5.2 km');
    expect(screen.getByText('480.00 ብር')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: /Accept/ }));
    await waitFor(() => {
      expect(calls.filter((call) => call.key === 'GET /driver/board')).toHaveLength(2);
    });
    expect(calls.some((call) => call.key === `POST /driver/offers/${offerId}/accept`)).toBe(true);
  });

  it('tells a browser visitor to open it from Telegram, without calling the API', () => {
    const { calls } = fakeServer({});
    renderAt('/', <DriverApp />);
    expect(screen.getByText(/Open this page from the Buchi bot in Telegram/)).toBeTruthy();
    expect(calls).toEqual([]);
  });
});
