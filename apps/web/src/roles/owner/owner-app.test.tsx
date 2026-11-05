import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
const order = {
  id: '3d6f0a2b-1c4e-4b5a-8d7c-9e0f1a2b3c4d',
  status: 'needs_review',
  deliveryType: 'express',
  total: '3630.00',
  deliveryFee: '130.00',
  customerName: 'Hana',
  paymentDeadline: null,
  createdAt: '2026-11-05T09:00:00.000Z',
  updatedAt: '2026-11-05T09:05:00.000Z',
  lines: [{ title: 'Nike Air', size: '42', quantity: 1 }],
};

/** A live stream that stays open with no events, like a quiet shop. */
const openStream = () => new Response(new ReadableStream(), { status: 200 });

describe('owner Mini App', () => {
  it('shows "not allowed" and no shop data to someone who does not own the shop', async () => {
    fakeTelegram();
    const { calls } = fakeServer({
      'POST /auth/mini-app': session,
      [`GET /shops/${shopId}`]: () =>
        json(403, { error: { code: 'FORBIDDEN', message: 'You do not own this shop' } }),
    });
    renderAt(`/shops/${shopId}`, <OwnerApp />);

    expect(await screen.findByText(/Not allowed/)).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Shop sections' })).toBeNull();
    expect(calls.map((call) => call.key)).toEqual(['POST /auth/mini-app', `GET /shops/${shopId}`]);
  });

  it('signs in with the Mini App launch data, not a stored token', async () => {
    const { webApp } = fakeTelegram();
    const { calls } = fakeServer({
      'POST /auth/mini-app': session,
      [`GET /shops/${shopId}`]: () => json(200, shop),
      [`GET /shops/${shopId}/orders`]: () => json(200, []),
      [`GET /shops/${shopId}/events`]: openStream,
    });
    renderAt(`/shops/${shopId}`, <OwnerApp />);

    await screen.findByText(/No orders yet/);
    const body = calls[0]?.init?.body;
    expect(typeof body === 'string' && JSON.parse(body)).toEqual({ initData: webApp.initData });
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('shows the order board and follows the shop’s live events', async () => {
    fakeTelegram();
    const { calls } = fakeServer({
      'POST /auth/mini-app': session,
      [`GET /shops/${shopId}`]: () => json(200, shop),
      [`GET /shops/${shopId}/orders`]: () => json(200, [order]),
      [`GET /shops/${shopId}/events`]: openStream,
    });
    renderAt(`/shops/${shopId}`, <OwnerApp />);

    const board = await screen.findByRole('region', { name: 'Checking payment' });
    expect(board.textContent).toContain('Hana');
    expect(board.textContent).toContain('Needs review');
    expect(board.textContent).toContain('1 × Nike Air · size 42');
    await waitFor(() => {
      expect(calls.some((call) => call.key === `GET /shops/${shopId}/events`)).toBe(true);
    });
  });

  it('asks a user without a shop to open one, and checks the name first', async () => {
    fakeTelegram();
    const { calls } = fakeServer({
      'POST /auth/mini-app': session,
      'GET /shops': () => json(200, []),
    });
    renderAt('/', <OwnerApp />);

    await userEvent.type(await screen.findByLabelText('Shop name'), 'S');
    await userEvent.click(screen.getByRole('button', { name: 'Create shop' }));
    expect(screen.getByLabelText('Shop name').getAttribute('aria-invalid')).toBe('true');
    expect(calls.some((call) => call.key === 'POST /shops')).toBe(false);
  });
});
