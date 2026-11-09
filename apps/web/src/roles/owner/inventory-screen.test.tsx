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
const boots = {
  id: '2a3b4c5d-6e7f-4a8b-9c0d-1e2f3a4b5c6d',
  title: 'Leather boots',
  description: '',
  pricingMode: 'negotiable',
  price: '1000.00',
  lowestPrice: '800.00',
  photoFileIds: [],
  active: true,
  createdAt: '2026-11-01T08:00:00.000Z',
  variants: [
    { id: '3b4c5d6e-7f8a-4b9c-8d1e-2f3a4b5c6d7e', size: '41', color: null, stock: 3, reserved: 0 },
  ],
};

function showInventory() {
  fakeTelegram();
  fakeServer({
    'POST /auth/mini-app': session,
    [`GET /shops/${shopId}`]: () => json(200, shop),
    [`GET /shops/${shopId}/products`]: () => json(200, [boots]),
  });
  renderAt(`/shops/${shopId}/inventory`, <OwnerApp />);
}

describe('inventory price labels', () => {
  it('says where each price of a negotiable product is shown', async () => {
    showInventory();

    expect(
      await screen.findByText(
        'Asking 1,000.00 ብር in chat · lowest 800.00 ብር, never shown to customers',
      ),
    ).toBeTruthy();
  });
});

describe('removing a product', () => {
  it('asks first, then removes it and reloads the list', async () => {
    fakeTelegram();
    let removed = false;
    const { calls } = fakeServer({
      'POST /auth/mini-app': session,
      [`GET /shops/${shopId}`]: () => json(200, shop),
      [`GET /shops/${shopId}/products`]: () => json(200, [{ ...boots, active: !removed }]),
      [`DELETE /shops/${shopId}/products/${boots.id}`]: () => {
        removed = true;
        return json(200, { removed: 'archived' });
      },
      [`POST /shops/${shopId}/products/${boots.id}/restore`]: () => {
        removed = false;
        return json(200, boots);
      },
    });
    renderAt(`/shops/${shopId}/inventory`, <OwnerApp />);

    fireEvent.click(await screen.findByRole('button', { name: 'Remove · አስወግድ' }));
    expect(screen.getByText(/Customers can no longer find or buy it/)).toBeTruthy();
    expect(calls.some((call) => call.key.startsWith('DELETE'))).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    expect(await screen.findByText('Removed products · የተወገዱ (1)')).toBeTruthy();
    expect(screen.getByText('No products yet · ገና ዕቃ የለም')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    expect(await screen.findByRole('button', { name: 'Remove · አስወግድ' })).toBeTruthy();
    expect(screen.queryByText(/Removed products/)).toBeNull();
  });
});
