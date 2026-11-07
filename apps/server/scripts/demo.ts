/**
 * The demo shop's data, run against the database in DATABASE_URL. See docs/DEMO.md.
 *
 *   pnpm --filter @buchi/server demo:seed <shop-id>
 *   pnpm --filter @buchi/server demo:photos <shop-id>
 *   pnpm --filter @buchi/server demo:reset <shop-id>
 *   pnpm --filter @buchi/server demo:scenario <name> <shop-id> [--customer <id>] [--driver <id>]
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { Api } from 'grammy';
import { pino } from 'pino';
import { z } from 'zod';
import { loadDatabaseUrl } from '../src/config/env';
import { connectDatabase, type Database } from '../src/db/client';
import { CatalogRepo } from '../src/modules/catalog/catalog.repo';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { ProductEmbeddingService } from '../src/modules/catalog/product-embeddings.service';
import { AreaNotesRepo } from '../src/modules/delivery/area-notes.repo';
import { AreaNoteService } from '../src/modules/delivery/area-notes.service';
import { DeliveryService } from '../src/modules/delivery/delivery.service';
import { DeliverySettingsRepo } from '../src/modules/delivery/delivery-settings.repo';
import { ZoneFactorsRepo } from '../src/modules/delivery/zone-factors.repo';
import { ZoneFactorService } from '../src/modules/delivery/zone-factors.service';
import {
  demoPhotoSchema,
  demoTitle,
  type DemoPhoto,
} from '../src/modules/demo/demo-catalog.domain';
import { DemoRepo } from '../src/modules/demo/demo.repo';
import { DemoReset } from '../src/modules/demo/demo-reset.service';
import { scenarioNames } from '../src/modules/demo/demo-scenarios.domain';
import { DemoScenariosRepo } from '../src/modules/demo/demo-scenarios.repo';
import { DemoScenarios } from '../src/modules/demo/demo-scenarios.service';
import { DemoSeeder } from '../src/modules/demo/demo-seed.service';
import { AcceptanceFactorService } from '../src/modules/far-quotes/acceptance-factors.service';
import { FarQuotesRepo } from '../src/modules/far-quotes/far-quotes.repo';
import { TimersRepo } from '../src/modules/jobs/timers.repo';
import { ShopsRepo } from '../src/modules/shops/shops.repo';
import { ShopsService } from '../src/modules/shops/shops.service';
import { TelegramPhotoUploads } from '../src/telegram/photo-uploads';

/** The private photo folder. It is gitignored, and its list names each photo's product. */
const PHOTOS_DIR = fileURLToPath(new URL('../../../evals/inbox/photos/', import.meta.url));
/** Telegram allows about one photo a second in one chat. */
const UPLOAD_GAP_MS = 1500;

const noTelegram = {
  verifyPostingRights: () => Promise.reject(new Error('The demo scripts do not post')),
  publish: () => Promise.reject(new Error('The demo scripts do not post')),
};

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { customer: { type: 'string' }, driver: { type: 'string' } },
});
const [command, ...rest] = positionals;
const now = () => new Date();
const { db, close } = connectDatabase(loadDatabaseUrl(process.env));
const shopIdArg = (value: string | undefined) => z.uuid().parse(value);
const userIdArg = (name: string, value: string | undefined) =>
  z.coerce
    .number({ error: `Pass --${name} <Telegram user ID>` })
    .int()
    .positive()
    .parse(value);

try {
  switch (command) {
    case 'seed':
      console.log(await seeder(db).seed(shopIdArg(rest[0]), await demoPhotos()));
      break;
    case 'reset':
      console.log(await reset(db).reset(shopIdArg(rest[0])));
      break;
    case 'photos':
      await uploadPhotos(shopIdArg(rest[0]));
      break;
    case 'scenario':
      await runScenario(z.enum(scenarioNames).parse(rest[0]), shopIdArg(rest[1]));
      break;
    default:
      throw new Error('Use: seed | reset | photos | scenario <name>, then the shop ID');
  }
} finally {
  await close();
}

async function demoPhotos(): Promise<DemoPhoto[]> {
  const list = await readFile(`${PHOTOS_DIR}demo-photos.json`, 'utf8');
  return z.array(demoPhotoSchema).parse(JSON.parse(list));
}

function shops(database: Database): ShopsService {
  return new ShopsService(database, new ShopsRepo(database), noTelegram);
}

/** Only the saved settings are used, so routing, traffic, and pauses are never asked. */
function delivery(database: Database): DeliveryService {
  const unused = () => Promise.reject(new Error('The demo scripts do not route'));
  return new DeliveryService(
    database,
    new DeliverySettingsRepo(),
    shops(database),
    { between: unused },
    unused,
    { deliveryPaused: unused },
  );
}

function catalog(database: Database): CatalogService {
  // The scripts publish no events: the running server's own flows react to the owner's changes.
  const noEvents = { publish: () => Promise.resolve() };
  // Only the server's timer tick computes the embeddings that the products queue.
  const embeddings = new ProductEmbeddingService(
    database,
    new CatalogRepo(),
    { embed: () => Promise.reject(new Error('The demo scripts do not embed')) },
    new TimersRepo(database),
    now,
    pino({ level: 'silent' }),
    noEvents,
  );
  return new CatalogService(
    database,
    new CatalogRepo(),
    shops(database),
    noTelegram,
    'unused',
    embeddings,
    noEvents,
  );
}

function reset(database: Database): DemoReset {
  return new DemoReset(
    database,
    new DemoRepo(),
    new ZoneFactorService(new ZoneFactorsRepo(database), now),
    new AcceptanceFactorService(database, new FarQuotesRepo(), now),
  );
}

function seeder(database: Database): DemoSeeder {
  return new DemoSeeder(
    database,
    new DemoRepo(),
    shops(database),
    delivery(database),
    catalog(database),
    new ZoneFactorService(new ZoneFactorsRepo(database), now),
    new AcceptanceFactorService(database, new FarQuotesRepo(), now),
    new AreaNoteService(database, new AreaNotesRepo(), now),
    reset(database),
    now,
  );
}

/**
 * Uploads each demo product's photo the way the dashboard does: to the owner's chat with the
 * bot, which then deletes it. A product that already has a photo is skipped.
 */
async function uploadPhotos(shopId: string): Promise<void> {
  const token = z.string().min(1, 'Set TELEGRAM_BOT_TOKEN').parse(process.env.TELEGRAM_BOT_TOKEN);
  const uploads = new TelegramPhotoUploads(new Api(token));
  const [owner] = await shops(db).ownerIds(shopId);
  if (owner === undefined) throw new Error('The shop has no owner');
  const products = catalog(db);
  const listed = await products.listProducts(shopId);
  for (const photo of await demoPhotos()) {
    const product = listed.find((row) => row.title === demoTitle(photo));
    if (!product || product.photoFileIds.length > 0) continue;
    const fileId = await uploads.upload(owner, await readFile(`${PHOTOS_DIR}${photo.photo}`));
    await products.attachPhoto([shopId], product.id, fileId);
    console.log(`Added the photo of ${product.title}`);
    await new Promise((resolve) => setTimeout(resolve, UPLOAD_GAP_MS));
  }
}

async function runScenario(name: (typeof scenarioNames)[number], shopId: string): Promise<void> {
  const scenarios = new DemoScenarios(
    db,
    new DemoScenariosRepo(),
    shops(db),
    delivery(db),
    new TimersRepo(db),
    now,
  );
  switch (name) {
    case 'late-delivery':
    case 'customer-silent': {
      const people = {
        customer: userIdArg('customer', values.customer),
        driver: userIdArg('driver', values.driver),
      };
      const trip = await scenarios.onTheRoad(shopId, people, name === 'late-delivery');
      console.log(`Order ${trip.order} (${trip.product}) is on the road with the driver.`);
      console.log(
        name === 'late-delivery'
          ? 'Within a minute the operations agent messages the customer and the driver about the delay.'
          : 'Now, as the driver, write in the bot chat: "The customer is not answering the phone." ' +
              `The late check stays at ${trip.lateCheckAt.toISOString()}.`,
      );
      return;
    }
    case 'restock-waitlist': {
      const waited = await scenarios.restockWaitlist(
        shopId,
        userIdArg('customer', values.customer),
      );
      console.log(`The customer is first in line for ${waited.product}, size ${waited.size}.`);
      console.log(
        'Now, as the owner, set that size to 1 in the dashboard: the customer gets a held unit.',
      );
      return;
    }
    case 'far-over-cap': {
      const spot = await scenarios.farOverCap(shopId);
      console.log(
        `As the customer, buy a product and share this location: ${spot.point.latitude.toFixed(5)}, ` +
          `${spot.point.longitude.toFixed(5)} (${String(spot.km)} km away).`,
      );
      console.log(
        `Its formula payout is about ${spot.payout} birr, above the ${spot.cap} cap, so the owner ` +
          'gets Approve once and Offer pickup.',
      );
      return;
    }
  }
}
