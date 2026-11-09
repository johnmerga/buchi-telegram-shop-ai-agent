import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fakeServer, fakeTelegram, json, renderAt, session } from '../../test/fakes';
import { OwnerApp } from '../../roles/owner/owner-app';
import { am } from './am';
import { en } from './en';
import { translate } from './index';

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

function showInventory() {
  fakeServer({
    'POST /auth/mini-app': session,
    [`GET /shops/${shopId}`]: () => json(200, shop),
    [`GET /shops/${shopId}/products`]: () => json(200, []),
  });
  renderAt(`/shops/${shopId}/inventory`, <OwnerApp />);
}

describe('dictionaries', () => {
  it('fill every Amharic entry with its own words and keep each value mark', () => {
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(am[key].trim(), key).not.toBe('');
      const marks = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();
      expect(marks(am[key]), key).toEqual(marks(en[key]));
    }
  });

  it('fills value marks', () => {
    expect(translate('en', 'orders.size', { size: '42' })).toBe('size 42');
    expect(translate('am', 'orders.size', { size: '42' })).toBe('መጠን 42');
  });
});

describe('language choice', () => {
  it('starts in English and switches every label with the round button', async () => {
    fakeTelegram();
    showInventory();
    expect(await screen.findByText('No products yet')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Inventory' })).toBeTruthy();
    expect(document.documentElement.lang).toBe('en');

    fireEvent.click(screen.getByRole('button', { name: 'Switch to Amharic' }));

    expect(await screen.findByRole('link', { name: 'ዕቃዎች' })).toBeTruthy();
    expect(screen.getByText('ገና ዕቃ የለም')).toBeTruthy();
    expect(screen.queryByText('No products yet')).toBeNull();
    expect(document.documentElement.lang).toBe('am');
    expect(localStorage.getItem('buchi.lang')).toBe('am');
  });

  it('opens in Amharic when the Telegram app is in Amharic', async () => {
    fakeTelegram({ initDataUnsafe: { user: { language_code: 'am' } } });
    showInventory();
    expect(await screen.findByRole('link', { name: 'ዕቃዎች' })).toBeTruthy();
  });

  it('keeps a saved choice over the Telegram app language', async () => {
    localStorage.setItem('buchi.lang', 'en');
    fakeTelegram({ initDataUnsafe: { user: { language_code: 'am' } } });
    showInventory();
    expect(await screen.findByRole('link', { name: 'Inventory' })).toBeTruthy();
  });
});
