import { Money, type DeliverySettings } from '@buchi/shared';
import type { Database } from '../../db/client';
import { withShop } from '../../db/with-shop';
import { seededRandom, seededUuid } from '../../shared/seeded-random';
import type { CatalogService } from '../catalog/catalog.service';
import type { AreaNoteService } from '../delivery/area-notes.service';
import type { DeliveryService } from '../delivery/delivery.service';
import type { Coordinates } from '../delivery/location.domain';
import type { ZoneFactorService } from '../delivery/zone-factors.service';
import { zoneOf } from '../delivery/zones.domain';
import type { AcceptanceFactorService } from '../far-quotes/acceptance-factors.service';
import { syntheticTrips } from '../far-quotes/synthetic-trips.domain';
import type { ShopsService } from '../shops/shops.service';
import { demoProducts, type DemoPhoto } from './demo-catalog.domain';
import { planHistory, type DemoHistory, type HistoryProduct } from './demo-history.domain';
import type { DemoRepo, ResetCounts } from './demo.repo';
import type { DemoReset } from './demo-reset.service';
import { DEMO_AREA_NOTES, DEMO_DELIVERY_SETTINGS, DEMO_DRIVERS } from './demo-shop.domain';

/** Every run starts from this generator state, so the demo shop looks the same each time. */
const SEED = 20_261_107;
const CUSTOMERS = 40;
const ORDERS = 120;
const DAYS = 42;
const FAR_TRIPS = 120;
const WAITLISTED = 3;

export interface SeedSummary {
  removed: ResetCounts;
  settings: DeliverySettings;
  /** False when the shop has no location yet, so every demo order is a pickup. */
  deliveries: boolean;
  products: number;
  customers: number;
  orders: number;
  trips: number;
  farTrips: number;
  waitlist: { product: string; size: string } | null;
}

/**
 * Fills a shop with weeks of demo history: synthetic customers, drivers, orders, payments, trips,
 * far-trip prices, area notes, and a waitlist, then learns the factors from them. It resets the
 * shop's earlier demo data first, so running it again gives the same shop.
 */
export class DemoSeeder {
  constructor(
    private readonly db: Database,
    private readonly repo: DemoRepo,
    private readonly shops: Pick<ShopsService, 'get'>,
    private readonly delivery: Pick<DeliveryService, 'saveSettings' | 'savedSettings'>,
    private readonly catalog: Pick<
      CatalogService,
      'createListing' | 'listProducts' | 'setVariants'
    >,
    private readonly zoneFactors: Pick<ZoneFactorService, 'addSyntheticLegs' | 'learn'>,
    private readonly acceptance: Pick<AcceptanceFactorService, 'addSynthetic' | 'learnAll'>,
    private readonly notes: Pick<AreaNoteService, 'addDriverReport'>,
    private readonly reset: Pick<DemoReset, 'reset'>,
    private readonly now: () => Date,
  ) {}

  async seed(shopId: string, photos: DemoPhoto[]): Promise<SeedSummary> {
    const removed = await this.reset.reset(shopId);
    const random = seededRandom(SEED);
    await this.delivery.saveSettings(shopId, DEMO_DELIVERY_SETTINGS);
    const shop = await this.shops.get(shopId);
    const origin =
      shop.latitude === null || shop.longitude === null
        ? null
        : { latitude: shop.latitude, longitude: shop.longitude };
    const demoIds = await this.addProducts(shopId, demoProducts(photos, random));
    const drivers = DEMO_DRIVERS.map((driver) => ({ ...driver, id: seededUuid(random) }));
    const history = await withShop(this.db, shopId, async (tx) => {
      await this.repo.insertDrivers(tx, shopId, drivers, this.daysAgo(DAYS + 7));
      const realDrivers = await this.repo.realDriverIds(tx);
      const plan = planHistory({
        random,
        now: this.now(),
        origin,
        settings: DEMO_DELIVERY_SETTINGS,
        products: await this.historyProducts(shopId, demoIds),
        driverIds: [...drivers.map((driver) => driver.id), ...realDrivers],
        customers: CUSTOMERS,
        orders: ORDERS,
        days: DAYS,
      });
      await this.repo.insertCustomers(tx, shopId, plan.customers);
      await this.repo.insertOrders(tx, shopId, plan.orders);
      return plan;
    });
    await this.addLegs(history);
    const farTrips = origin ? await this.addFarTrips(shopId, origin, random) : 0;
    if (origin) {
      for (const note of DEMO_AREA_NOTES) await this.notes.addDriverReport(shopId, note);
    }
    const waitlisted = await this.addWaitlist(shopId, demoIds, history);
    await this.zoneFactors.learn();
    await this.acceptance.learnAll();
    return {
      removed,
      settings: DEMO_DELIVERY_SETTINGS,
      deliveries: origin !== null,
      products: demoIds.length,
      customers: history.customers.length,
      orders: history.orders.length,
      trips: history.orders.filter((order) => order.trip !== null).length,
      farTrips,
      waitlist: waitlisted,
    };
  }

  /** Creates the products through the catalog, so their photo-search embeddings are queued. */
  private async addProducts(
    shopId: string,
    products: ReturnType<typeof demoProducts>,
  ): Promise<string[]> {
    const ids: string[] = [];
    for (const { product, variants } of products) {
      const row = await this.catalog.createListing(shopId, { product, variants, photoFileIds: [] });
      await withShop(this.db, shopId, (tx) => this.repo.markSynthetic(tx, row.id));
      ids.push(row.id);
    }
    return ids;
  }

  /**
   * The products customers bought: three demo best-sellers first, then the shop's own products,
   * then the other demo products, with the last one barely selling.
   */
  private async historyProducts(shopId: string, demoIds: string[]): Promise<HistoryProduct[]> {
    const all = await this.catalog.listProducts(shopId);
    const active = all.filter((product) => product.active && product.variants.length > 0);
    const demo = demoIds.flatMap((id) => active.filter((product) => product.id === id));
    const own = active.filter((product) => !demoIds.includes(product.id));
    return [...demo.slice(0, 3), ...own, ...demo.slice(3)].map((product) => ({
      pricingMode: product.pricingMode,
      price: Money.of(product.price),
      lowestPrice: product.lowestPrice === null ? null : Money.of(product.lowestPrice),
      variantIds: product.variants.map((variant) => variant.id),
    }));
  }

  /** Each delivered trip is a road leg for the time factors, marked synthetic like the far trips. */
  private async addLegs(history: DemoHistory): Promise<void> {
    const legs = history.orders.flatMap(({ trip, pin }) =>
      trip && pin
        ? [
            {
              zone: zoneOf(pin),
              startedAt: trip.pickedUpAt,
              routingSeconds: trip.routingSeconds,
              actualSeconds: trip.actualMinutes * 60,
            },
          ]
        : [],
    );
    if (legs.length > 0) await this.zoneFactors.addSyntheticLegs(legs);
  }

  /** Far trips that drivers held after raises, the far-price agent's evidence. */
  private async addFarTrips(
    shopId: string,
    origin: Coordinates,
    random: () => number,
  ): Promise<number> {
    const trips = syntheticTrips({
      origin,
      settings: DEMO_DELIVERY_SETTINGS,
      now: this.now(),
      count: FAR_TRIPS,
      seed: Math.floor(random() * 2 ** 32),
    });
    await this.zoneFactors.addSyntheticLegs(trips.map((trip) => trip.leg));
    await this.acceptance.addSynthetic(
      shopId,
      trips.map((trip) => trip.far),
    );
    return trips.length;
  }

  /**
   * A sold-out size of the second demo product, with demo customers waiting for it. The owner's
   * restock then reaches them in the order they joined.
   */
  private async addWaitlist(
    shopId: string,
    demoIds: string[],
    history: DemoHistory,
  ): Promise<{ product: string; size: string } | null> {
    const productId = demoIds[1];
    const product = (await this.catalog.listProducts(shopId)).find((row) => row.id === productId);
    const variant = product?.variants[2];
    if (!product || !variant || variant.reserved > 0) return null;
    await this.catalog.setVariants(
      shopId,
      product.id,
      product.variants.map(({ size, color, stock }) => ({
        size,
        color,
        stock: size === variant.size ? 0 : stock,
      })),
    );
    const waiting = history.customers.slice(0, WAITLISTED).map((customer, index) => ({
      customerId: customer.id,
      joinedAt: this.daysAgo(WAITLISTED - index),
    }));
    await withShop(this.db, shopId, (tx) =>
      this.repo.joinWaitlist(tx, shopId, variant.id, waiting),
    );
    return { product: product.title, size: variant.size };
  }

  private daysAgo(days: number): Date {
    return new Date(this.now().getTime() - days * 24 * 60 * 60_000);
  }
}
