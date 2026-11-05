import { and, eq } from 'drizzle-orm';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectDatabase } from '../../src/db/client';
import { landmarks, timers } from '../../src/db/schema';
import { withShop } from '../../src/db/with-shop';
import { createApp } from '../../src/http/app';
import { requireAuth } from '../../src/http/middleware/require-auth';
import { requireShopOwner } from '../../src/http/middleware/require-shop-owner';
import { AuthService } from '../../src/modules/auth/auth.service';
import { DeliverySettingsRepo } from '../../src/modules/delivery/delivery-settings.repo';
import { createDeliveryRouter } from '../../src/modules/delivery/delivery.routes';
import { DeliveryService } from '../../src/modules/delivery/delivery.service';
import { LandmarksRepo } from '../../src/modules/delivery/landmarks.repo';
import { LandmarkService } from '../../src/modules/delivery/landmarks.service';
import type { Coordinates } from '../../src/modules/delivery/location.domain';
import { RouteService } from '../../src/modules/delivery/route.service';
import {
  SAVER_RUN_TIMER,
  SaverScheduleService,
} from '../../src/modules/delivery/saver-schedule.service';
import { TimersRepo } from '../../src/modules/jobs/timers.repo';
import { TimerService } from '../../src/modules/jobs/timers.service';
import { ShopsRepo } from '../../src/modules/shops/shops.repo';
import { ShopsService } from '../../src/modules/shops/shops.service';
import { launchFields, signInitData } from '../sign-init-data';
import { testDatabaseUrl } from './test-database';
import { noPauses } from '../fakes/no-owner-rules';

const { db, close } = connectDatabase(testDatabaseUrl);
afterAll(close);

const logger = pino({ level: 'silent' });
const unusedChannels = { verifyPostingRights: () => Promise.reject(new Error('not used')) };
const shops = new ShopsService(db, new ShopsRepo(db), unusedChannels);
const routes = new RouteService(
  {
    route: () => Promise.resolve({ meters: 6000, seconds: 1200 }),
    matrix: () => Promise.reject(new Error('unused')),
  },
  logger,
  () => new Date(),
);
const delivery = new DeliveryService(
  db,
  new DeliverySettingsRepo(),
  shops,
  routes,
  () => Promise.resolve(1.5),
  noPauses,
);
/** 09:30 in Addis Ababa. */
let now = new Date('2026-11-05T06:30:00Z');
const saverSchedule = new SaverScheduleService(
  db,
  new DeliverySettingsRepo(),
  new TimerService(new TimersRepo(db), logger),
  () => now,
);

const botToken = '123456:test-token';
const auth = new AuthService({ botToken, tokenSecret: 't'.repeat(32), now: () => new Date() });
const app = createApp({
  logger,
  routers: [
    createDeliveryRouter({
      delivery,
      saverSchedule,
      requireAuth: requireAuth((token) => auth.verifyToken(token)),
      requireShopOwner: requireShopOwner((id) => shops.ownedShopIds(id)),
    }),
  ],
});

async function bearer(telegramUserId: number): Promise<string> {
  const initData = signInitData(launchFields(telegramUserId, new Date()), botToken);
  return `Bearer ${(await auth.signInWithMiniApp(initData)).token}`;
}

const settings = {
  baseFee: '40',
  ratePerKm: '12.50',
  ratePerMinute: '1.50',
  freeRadiusKm: 2.5,
  standardRangeKm: 8,
  farRangeKm: 20,
  farCap: '1000',
  saverDiscountPercent: 15,
};
const customerPin = { latitude: 8.9970566, longitude: 38.7866129 };

let shopId = '';
let otherShopId = '';

beforeAll(async () => {
  shopId = await shops.create(6001, { name: 'Delivery shop' });
  otherShopId = await shops.create(6002, { name: 'Other shop' });
});

describe('delivery settings API', () => {
  const path = () => `/shops/${shopId}/delivery-settings`;

  it('lets the owner save settings, and quotes from them once the shop has a location', async () => {
    expect(await delivery.offersDelivery(shopId)).toBe(false);

    const saved = await request(app)
      .put(path())
      .set('authorization', await bearer(6001))
      .send(settings);
    expect(saved.status).toBe(204);
    expect(await delivery.offersDelivery(shopId)).toBe(false);

    await shops.setLocation(shopId, { latitude: 9.0108, longitude: 38.7613 });
    expect(await delivery.offersDelivery(shopId)).toBe(true);
    const quote = await delivery.quote(shopId, customerPin);
    // 40 + 12.50 × 6 km + 1.50 × (20 min × 1.5) = 160, so Express is 160 and Saver 160 − 30 = 130.
    expect(quote?.options.map((o) => [o.type, o.fee.toString(), o.payout.toString()])).toEqual([
      ['express', '160.00', '160.00'],
      ['saver', '130.00', '160.00'],
      ['pickup', '0.00', '0.00'],
    ]);
  });

  it('replaces the settings when the owner saves again', async () => {
    const saved = await request(app)
      .put(path())
      .set('authorization', await bearer(6001))
      .send({ ...settings, freeRadiusKm: 6 });
    expect(saved.status).toBe(204);
    expect((await delivery.quote(shopId, customerPin))?.area).toBe('free');
  });

  it('rejects ranges that shrink outwards', async () => {
    const invalid = await request(app)
      .put(path())
      .set('authorization', await bearer(6001))
      .send({ ...settings, farRangeKm: 5 });
    expect(invalid.status).toBe(400);
    expect(invalid.body).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
  });

  it("keeps other users out of a shop's settings", async () => {
    const blocked = await request(app)
      .put(path())
      .set('authorization', await bearer(6002))
      .send(settings);
    expect(blocked.status).toBe(403);
  });
});

describe('Saver run times API', () => {
  const path = (id: string) => `/shops/${id}/saver-run-times`;
  const saverTimers = (id: string) =>
    db
      .select({ dueAt: timers.dueAt })
      .from(timers)
      .where(and(eq(timers.kind, SAVER_RUN_TIMER), eq(timers.shopId, id)))
      .orderBy(timers.createdAt);

  it('schedules the next run at the time the owner set', async () => {
    const saved = await request(app)
      .put(path(shopId))
      .set('authorization', await bearer(6001))
      .send({ times: ['14:00', '10:00'] });
    expect(saved.status).toBe(204);
    expect(await saverTimers(shopId)).toEqual([{ dueAt: new Date('2026-11-05T07:00:00Z') }]);
  });

  it('lets only the current timer claim a run, and chains the next one', async () => {
    const tenOClock = new Date('2026-11-05T07:00:00Z');
    now = tenOClock;
    await expect(saverSchedule.claim(shopId, tenOClock)).resolves.toBe(true);
    await expect(saverSchedule.claim(shopId, tenOClock)).resolves.toBe(false);
    expect((await saverTimers(shopId)).at(-1)).toEqual({
      dueAt: new Date('2026-11-05T11:00:00Z'),
    });
  });

  it('retires the old timer chain when the owner changes the times', async () => {
    const saved = await request(app)
      .put(path(shopId))
      .set('authorization', await bearer(6001))
      .send({ times: ['16:00'] });
    expect(saved.status).toBe(204);
    await expect(saverSchedule.claim(shopId, new Date('2026-11-05T11:00:00Z'))).resolves.toBe(
      false,
    );
    await expect(saverSchedule.claim(shopId, new Date('2026-11-05T13:00:00Z'))).resolves.toBe(true);
  });

  it('needs delivery settings first', async () => {
    const response = await request(app)
      .put(path(otherShopId))
      .set('authorization', await bearer(6002))
      .send({ times: ['10:00'] });
    expect(response.status).toBe(409);
  });

  it('rejects a time that is not a 24-hour time', async () => {
    const response = await request(app)
      .put(path(shopId))
      .set('authorization', await bearer(6001))
      .send({ times: ['25:00'] });
    expect(response.status).toBe(400);
  });
});

describe('landmark memory', () => {
  const ednaMall = { name: 'Edna Mall', area: 'Bole' };
  const searched: string[] = [];
  const geocoder = {
    search: (query: string): Promise<Coordinates | undefined> => {
      searched.push(query);
      return Promise.resolve({ latitude: 8.99706, longitude: 38.78661 });
    },
  };
  const memory = new LandmarkService(db, new LandmarksRepo(), geocoder, logger);

  it('asks Nominatim for a landmark the shop does not know yet', async () => {
    await expect(memory.find(shopId, ednaMall)).resolves.toEqual({
      source: 'nominatim',
      coordinates: { latitude: 8.99706, longitude: 38.78661 },
    });
    expect(searched).toEqual(['edna mall, bole']);
  });

  it('remembers confirmed pins under any spelling and counts the confirmations', async () => {
    await memory.confirm(shopId, ednaMall, { latitude: 8.9972, longitude: 38.7869 });
    await memory.confirm(shopId, { name: ' edna  MALL', area: 'bole' }, customerPin);

    await expect(memory.find(shopId, { name: 'EDNA mall', area: 'Bole' })).resolves.toEqual({
      source: 'memory',
      coordinates: customerPin,
      confirmations: 2,
    });
    expect(searched).toHaveLength(1);
  });

  it("keeps one shop's landmarks from another shop", async () => {
    await memory.find(otherShopId, ednaMall);
    expect(searched).toHaveLength(2);
    const visible = await withShop(db, otherShopId, (tx) => tx.select().from(landmarks));
    expect(visible).toEqual([]);
  });

  it('offers no suggestion when Nominatim is down', async () => {
    const offline = new LandmarkService(
      db,
      new LandmarksRepo(),
      { search: () => Promise.reject(new Error('Nominatim answered 503')) },
      logger,
    );
    await expect(offline.find(otherShopId, { name: 'Unknown', area: 'Kality' })).resolves.toBe(
      undefined,
    );
  });
});
