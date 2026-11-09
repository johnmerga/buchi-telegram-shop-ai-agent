import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

const photosPath = `/shops/${shopId}/products/${boots.id}/photos`;
const withPhoto = { ...boots, photoFileIds: ['photo-1'] };
const image = () =>
  new Response(new Uint8Array([0xff, 0xd8]), { headers: { 'content-type': 'image/jpeg' } });

/** Opens the editor; the product list answers with each of `listings` in turn, then the last. */
function showEditor(listings: object[], handlers: Parameters<typeof fakeServer>[0] = {}) {
  let served = 0;
  const server = fakeServer({
    'POST /auth/mini-app': session,
    [`GET /shops/${shopId}`]: () => json(200, shop),
    [`GET /shops/${shopId}/products`]: () =>
      json(200, [listings[Math.min(served++, listings.length - 1)]]),
    ...handlers,
  });
  renderAt(`/shops/${shopId}/inventory/${boots.id}`, <OwnerApp />);
  return server;
}

beforeEach(() => {
  fakeTelegram();
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:photo');
  vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('product editor', () => {
  it('names the editor price fields by who sees them', async () => {
    showEditor([boots]);

    expect(
      await screen.findByLabelText('Asking price (birr, said in chat, not on the post)'),
    ).toBeTruthy();
    expect(screen.getByLabelText('Lowest price (birr, never shown to customers)')).toBeTruthy();
    await userEvent.click(screen.getByLabelText('Fixed: the post shows the price'));
    expect(screen.getByLabelText('Price (birr)')).toBeTruthy();
  });

  it("shows the product's photos from the signed-in photo route", async () => {
    const { calls } = showEditor([withPhoto], { [`GET ${photosPath}/0`]: image });

    const photo = await screen.findByRole('img', { name: 'Photo 1' });
    expect(photo.getAttribute('src')).toBe('blob:photo');
    const fetched = calls.find((call) => call.key === `GET ${photosPath}/0`);
    expect(new Headers(fetched?.init?.headers).get('authorization')).toBe('Bearer test-token');
  });

  it('uploads a chosen photo as the request body and shows it', async () => {
    const { calls } = showEditor([boots, withPhoto], {
      [`POST ${photosPath}`]: () => json(201, withPhoto),
      [`GET ${photosPath}/0`]: image,
    });
    const photo = new File(['jpeg'], 'boots.jpg', { type: 'image/jpeg' });

    await userEvent.upload(await screen.findByLabelText('+ Add photo'), photo);

    expect(await screen.findByRole('img', { name: 'Photo 1' })).toBeTruthy();
    const upload = calls.find((call) => call.key === `POST ${photosPath}`);
    expect(upload?.init?.body).toBe(photo);
    expect(new Headers(upload?.init?.headers).get('content-type')).toBe('image/jpeg');
  });

  it('refuses a photo over 10 MB without sending it', async () => {
    const { calls } = showEditor([boots]);
    const huge = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'huge.png', {
      type: 'image/png',
    });

    await userEvent.upload(await screen.findByLabelText('+ Add photo'), huge);

    expect((await screen.findByRole('alert')).textContent).toContain('at most 10 MB');
    expect(calls.some((call) => call.key === `POST ${photosPath}`)).toBe(false);
  });

  it('shows why Telegram refused the photo', async () => {
    showEditor([boots], {
      [`POST ${photosPath}`]: () =>
        json(409, {
          error: {
            code: 'CONFLICT',
            message: 'Open the chat with the bot and press Start, then add the photo',
          },
        }),
    });

    await userEvent.upload(
      await screen.findByLabelText('+ Add photo'),
      new File(['jpeg'], 'boots.jpg', { type: 'image/jpeg' }),
    );

    expect((await screen.findByRole('alert')).textContent).toContain('press Start');
  });

  it('offers photos only once the product is saved', async () => {
    fakeServer({
      'POST /auth/mini-app': session,
      [`GET /shops/${shopId}`]: () => json(200, shop),
      [`GET /shops/${shopId}/products`]: () => json(200, []),
    });
    renderAt(`/shops/${shopId}/inventory/new`, <OwnerApp />);

    expect(await screen.findByText('New product')).toBeTruthy();
    expect(screen.queryByLabelText('+ Add photo')).toBeNull();
  });
});
