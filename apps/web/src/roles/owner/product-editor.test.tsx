import { screen } from '@testing-library/react';
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

function showEditor() {
  fakeTelegram();
  fakeServer({
    'POST /auth/mini-app': session,
    [`GET /shops/${shopId}`]: () => json(200, shop),
    [`GET /shops/${shopId}/products`]: () => json(200, [boots]),
  });
  renderAt(`/shops/${shopId}/inventory/${boots.id}`, <OwnerApp />);
}

describe('product editor', () => {
  it('names the editor price fields by who sees them', async () => {
    showEditor();

    expect(
      await screen.findByLabelText('Asking price (birr, said in chat, not on the post)'),
    ).toBeTruthy();
    expect(screen.getByLabelText('Lowest price (birr, never shown to customers)')).toBeTruthy();
    await userEvent.click(screen.getByLabelText('Fixed: the post shows the price'));
    expect(screen.getByLabelText('Price (birr)')).toBeTruthy();
  });
});
