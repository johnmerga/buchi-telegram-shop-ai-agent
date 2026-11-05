import type { Coordinates, Shop } from '@buchi/shared';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SignInGate } from '../../components/sign-in-gate';
import { fakeServer, fakeTelegram, json, renderAt, session } from '../../test/fakes';
import { LocationStep } from './location-step';

// Leaflet needs a real layout engine, so the map is a stand-in that shows its pin.
vi.mock('../../components/map/lazy-maps', () => ({
  LazyPinPickerMap: ({ value }: { value: Coordinates }) => (
    <p data-testid="pin">
      {value.latitude},{value.longitude}
    </p>
  ),
}));

const shopId = '6f1c2a4e-8b3d-4f5a-9c7e-1d2b3a4c5e6f';
const shop: Shop = {
  id: shopId,
  name: 'Selam Shoes',
  channelChatId: null,
  channelTitle: null,
  latitude: null,
  longitude: null,
  createdAt: '2026-11-01T08:00:00.000Z',
};
const adama = { name: 'Adama, East Shewa, Oromia', latitude: 8.54, longitude: 39.27 };
const search = 'GET /places?q=adama';

function renderStep() {
  renderAt(
    '/',
    <SignInGate browserSignIn={false}>
      <LocationStep shopId={shopId} shop={shop} />
    </SignInGate>,
  );
}

async function searchFor(text: string) {
  await userEvent.type(screen.getByRole('textbox', { name: 'Search for a place' }), text);
  await userEvent.click(screen.getByRole('button', { name: 'Search' }));
}

/** Telegram's LocationManager answering one location with the given accuracy. */
function telegramLocating(horizontalAccuracy: number | null) {
  fakeTelegram({
    LocationManager: {
      isInited: true,
      isLocationAvailable: true,
      init: vi.fn(),
      getLocation: (callback) => {
        callback({ latitude: 8.99, longitude: 38.78, horizontal_accuracy: horizontalAccuracy });
      },
    },
  });
}

describe('owner shop location step', () => {
  it('searches on submit only and moves the pin to the chosen place', async () => {
    fakeTelegram();
    const { calls } = fakeServer({
      'POST /auth/mini-app': session,
      [search]: () => json(200, [adama]),
    });
    renderStep();

    await searchFor('adama');
    expect(calls.filter((call) => call.key.startsWith('GET /places'))).toHaveLength(1);
    await userEvent.click(await screen.findByRole('button', { name: adama.name }));

    expect(screen.getByTestId('pin').textContent).toBe('8.54,39.27');
    expect(screen.queryByRole('list', { name: 'Places found' })).toBeNull();
  });

  it('does not search for one letter', async () => {
    fakeTelegram();
    const { calls } = fakeServer({ 'POST /auth/mini-app': session });
    renderStep();

    await userEvent.type(screen.getByRole('textbox', { name: 'Search for a place' }), 'a{Enter}');
    expect(screen.getByRole('button', { name: 'Search' })).toHaveProperty('disabled', true);
    expect(calls.some((call) => call.key.startsWith('GET /places'))).toBe(false);
  });

  it('says when no place matches', async () => {
    fakeTelegram();
    fakeServer({ 'POST /auth/mini-app': session, [search]: () => json(200, []) });
    renderStep();

    await searchFor('adama');
    expect(await screen.findByText('No places found.')).toBeTruthy();
  });

  it('shows the server’s message when the search fails', async () => {
    fakeTelegram();
    fakeServer({
      'POST /auth/mini-app': session,
      [search]: () =>
        json(503, { error: { code: 'UNAVAILABLE', message: 'Place search is not available.' } }),
    });
    renderStep();

    await searchFor('adama');
    expect((await screen.findByRole('alert')).textContent).toBe('Place search is not available.');
  });

  it('warns that a location from far off is approximate', async () => {
    telegramLocating(12_000);
    fakeServer({ 'POST /auth/mini-app': session });
    renderStep();

    await userEvent.click(screen.getByRole('button', { name: 'Use my location' }));
    expect(screen.getByTestId('pin').textContent).toBe('8.99,38.78');
    expect(screen.getByRole('status').textContent).toBe(
      'This location is approximate (about 12 km). Search your area or drag the pin.',
    );
  });

  it.each([
    ['a precise location', 30],
    ['a location without an accuracy', null],
  ])('shows no warning for %s', async (_case, accuracy) => {
    telegramLocating(accuracy);
    fakeServer({ 'POST /auth/mini-app': session });
    renderStep();

    await userEvent.click(screen.getByRole('button', { name: 'Use my location' }));
    await waitFor(() => {
      expect(screen.getByTestId('pin').textContent).toBe('8.99,38.78');
    });
    expect(screen.queryByRole('status')).toBeNull();
  });
});
