/**
 * Seeds 200 synthetic far trips, labeled synthetic, for a shop that has its location and delivery
 * settings, and one demo area note, then learns the zone factors from them. The zone map and the far-price evidence then
 * work from the first day of the demo. Run it once per shop.
 *
 *   pnpm --filter @buchi/server seed:synthetic-trips <shop-id>
 */
import { z } from 'zod';
import { loadDatabaseUrl } from '../src/config/env';
import { connectDatabase } from '../src/db/client';
import { withShop } from '../src/db/with-shop';
import { AreaNotesRepo } from '../src/modules/delivery/area-notes.repo';
import { AreaNoteService } from '../src/modules/delivery/area-notes.service';
import { DeliverySettingsRepo } from '../src/modules/delivery/delivery-settings.repo';
import { ZoneFactorsRepo } from '../src/modules/delivery/zone-factors.repo';
import { ZoneFactorService } from '../src/modules/delivery/zone-factors.service';
import { AcceptanceFactorService } from '../src/modules/far-quotes/acceptance-factors.service';
import { FarQuotesRepo } from '../src/modules/far-quotes/far-quotes.repo';
import { syntheticTrips } from '../src/modules/far-quotes/synthetic-trips.domain';
import { ShopsRepo } from '../src/modules/shops/shops.repo';

const TRIPS = 200;

const shopId = z.uuid().parse(process.argv[2]);
const { db, close } = connectDatabase(loadDatabaseUrl(process.env));
const now = () => new Date();

try {
  const { shop, settings } = await withShop(db, shopId, async (tx) => ({
    shop: await new ShopsRepo(db).find(tx, shopId),
    settings: await new DeliverySettingsRepo().find(tx),
  }));
  if (!shop || shop.latitude === null || shop.longitude === null || !settings) {
    throw new Error('Set the shop location and delivery settings first');
  }
  const origin = { latitude: shop.latitude, longitude: shop.longitude };
  const trips = syntheticTrips({
    origin,
    settings,
    now: now(),
    count: TRIPS,
    // Each shop gets its own trips, and so its own trip IDs.
    seed: Number.parseInt(shopId.slice(0, 8), 16),
  });
  const zoneFactors = new ZoneFactorService(new ZoneFactorsRepo(db), now);
  const acceptance = new AcceptanceFactorService(db, new FarQuotesRepo(), now);
  await zoneFactors.addSyntheticLegs(trips.map((trip) => trip.leg));
  await acceptance.addSynthetic(
    shopId,
    trips.map((trip) => trip.far),
  );
  const south = trips.find((trip) => trip.destination.latitude < origin.latitude - 0.08);
  if (south) {
    await new AreaNoteService(db, new AreaNotesRepo(), now).addDriverReport(shopId, {
      near: south.destination,
      note: 'Demo note: roadworks on the ring road near Kality, expect 20 extra minutes.',
      validHours: 72,
    });
  }
  const time = await zoneFactors.learn();
  const prices = await acceptance.learnAll();
  console.log(
    `Seeded ${String(TRIPS)} synthetic trips: ${String(time.zones)} time-factor zones, ` +
      `${String(prices.acceptanceZones)} acceptance-factor zones.`,
  );
} finally {
  await close();
}
