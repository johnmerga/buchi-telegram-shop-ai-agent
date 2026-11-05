import { placeSchema, type Place } from '@buchi/shared';
import { pino } from 'pino';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp } from '../src/http/app';
import { requireAuth } from '../src/http/middleware/require-auth';
import { AuthService } from '../src/modules/auth/auth.service';
import { createPlacesRouter } from '../src/modules/delivery/places.routes';
import { PlaceSearchService, type PlaceFinder } from '../src/modules/delivery/places.service';
import { launchFields, signInitData } from './sign-init-data';

const botToken = '123456:test-bot-token';
const adama: Place = { name: 'Adama, East Shewa, Oromia', latitude: 8.54, longitude: 39.27 };

const auth = new AuthService({
  botToken,
  tokenSecret: 'test-auth-token-secret-at-least-32-chars',
  now: () => new Date(),
});

function placesApp(finder: PlaceFinder) {
  const logger = pino({ level: 'silent' });
  return createApp({
    logger,
    trustProxyHops: 0,
    routers: [
      createPlacesRouter({
        places: new PlaceSearchService(finder, logger),
        requireAuth: requireAuth((token) => auth.verifyToken(token)),
      }),
    ],
  });
}

async function bearer(): Promise<string> {
  const { token } = await auth.signInWithMiniApp(
    signInitData(launchFields(42, new Date()), botToken),
  );
  return `Bearer ${token}`;
}

describe('GET /places', () => {
  it('needs a signed-in user', async () => {
    const res = await request(placesApp({ searchPlaces: () => Promise.resolve([adama]) }))
      .get('/places')
      .query({ q: 'adama' });
    expect(res.status).toBe(401);
  });

  it('searches the trimmed query and answers the places', async () => {
    const queries: string[] = [];
    const app = placesApp({
      searchPlaces: (query) => {
        queries.push(query);
        return Promise.resolve([adama]);
      },
    });
    const res = await request(app)
      .get('/places')
      .query({ q: '  adama ' })
      .set('authorization', await bearer());
    expect(res.status).toBe(200);
    expect(z.array(placeSchema).parse(res.body)).toEqual([adama]);
    expect(queries).toEqual(['adama']);
  });

  it.each([
    ['a missing query', {}],
    ['a one-letter query', { q: ' a ' }],
    ['a query over 100 letters', { q: 'a'.repeat(101) }],
  ])('rejects %s', async (_case, query) => {
    const app = placesApp({ searchPlaces: () => Promise.resolve([adama]) });
    const res = await request(app)
      .get('/places')
      .query(query)
      .set('authorization', await bearer());
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
  });

  it('answers UNAVAILABLE when the place search fails', async () => {
    const app = placesApp({
      searchPlaces: () => Promise.reject(new Error('Nominatim answered 503')),
    });
    const res = await request(app)
      .get('/places')
      .query({ q: 'adama' })
      .set('authorization', await bearer());
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ error: { code: 'UNAVAILABLE' } });
  });
});
