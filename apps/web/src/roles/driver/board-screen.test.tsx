import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeServer, fakeTelegram, json, renderAt, session } from '../../test/fakes';
import { DriverApp } from './driver-app';

const farOfferId = '0b9d8c7a-6e5f-4a3b-9c2d-1e0f9a8b7c6d';
const offerId = '1c0e9d8b-7f6a-4b4c-8d3e-2f1a0b9c8d7e';
const heldOfferId = '2d1f0e9c-8a7b-4c5d-9e4f-3a2b1c0d9e8f';
const offer = {
  shopName: 'Selam Shoes',
  stops: 1,
  routeMeters: 5200,
  estimatedMinutes: 18,
};
const board = {
  offers: [
    { ...offer, offerId: farOfferId, price: '360.00', far: true, raised: true },
    { ...offer, offerId, price: '160.00', far: false, raised: true },
  ],
  held: [{ ...offer, offerId: heldOfferId, price: '420.00', far: true, raised: false }],
  trips: [],
  earnings: [{ shopName: 'Selam Shoes', deliveredTrips: 3, payout: '480.00' }],
};

describe('driver Mini App', () => {
  it('accepts an open job and shows payouts', async () => {
    fakeTelegram();
    const { calls } = fakeServer({
      'POST /auth/mini-app': session,
      'GET /driver/board': () => json(200, board),
      [`POST /driver/offers/${offerId}/accept`]: () => json(200, { result: 'accepted' }),
    });
    renderAt('/', <DriverApp />);

    const open = await screen.findByRole('region', { name: 'Open jobs' });
    expect(open.textContent).toContain('160.00 ብር');
    expect(open.textContent).toContain('5.2 km');
    expect(open.textContent).toContain('Bonus');
    expect(screen.getByText('480.00 ብር')).toBeTruthy();

    await userEvent.click(within(open).getByRole('button', { name: /Accept/ }));
    await waitFor(() => {
      expect(calls.filter((call) => call.key === 'GET /driver/board')).toHaveLength(2);
    });
    expect(calls.some((call) => call.key === `POST /driver/offers/${offerId}/accept`)).toBe(true);
  });

  it('holds a far-area offer under Special offers instead of accepting it', async () => {
    fakeTelegram();
    const { calls } = fakeServer({
      'POST /auth/mini-app': session,
      'GET /driver/board': () => json(200, board),
      [`POST /driver/offers/${farOfferId}/hold`]: () => json(200, { result: 'closed' }),
    });
    renderAt('/', <DriverApp />);

    const special = await screen.findByRole('region', { name: 'Special offers' });
    expect(special.textContent).toContain('360.00 ብር');
    expect(special.textContent).toContain('Price raised');
    expect(within(special).queryByRole('button', { name: /Accept/ })).toBeNull();

    await userEvent.click(within(special).getByRole('button', { name: /Hold this price/ }));
    expect(await within(special).findByText('Another driver holds this job.')).toBeTruthy();
    expect(calls.some((call) => call.key.endsWith(`${farOfferId}/accept`))).toBe(false);
  });

  it('lists the far-area jobs the driver holds until the customer pays', async () => {
    fakeTelegram();
    fakeServer({
      'POST /auth/mini-app': session,
      'GET /driver/board': () => json(200, board),
    });
    renderAt('/', <DriverApp />);

    const held = await screen.findByRole('region', { name: 'Held for you' });
    expect(held.textContent).toContain('420.00 ብር');
    expect(held.textContent).toContain('It is yours once the customer pays');
    expect(within(held).queryByRole('button')).toBeNull();
  });

  it('tells a browser visitor to open it from Telegram, without calling the API', () => {
    const { calls } = fakeServer({});
    renderAt('/', <DriverApp />);
    expect(screen.getByText(/Open this page from the Buchi bot in Telegram/)).toBeTruthy();
    expect(calls).toEqual([]);
  });
});
