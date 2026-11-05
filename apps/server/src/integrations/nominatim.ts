import type { Place } from '@buchi/shared';
import { z } from 'zod';
import type { PlaceFinder } from '../modules/delivery/places.service';
import type { Geocoder } from '../modules/delivery/landmarks.service';
import type { Coordinates } from '../modules/delivery/location.domain';
import { RequestSpacer } from '../shared/request-spacer';
import { TtlCache } from '../shared/ttl-cache';

const SEARCH_URL = 'https://nominatim.openstreetmap.org/search';
/** Addis Ababa as `west,north,east,south`. Results outside it are never the customer's landmark. */
const ADDIS_ABABA_VIEWBOX = '38.63,9.10,38.92,8.83';
/** The usage policy allows at most one request a second. */
const MIN_INTERVAL_MS = 1000;
const TIMEOUT_MS = 5000;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_CACHED_SEARCHES = 2000;
const MAX_PLACES = 5;
/** A full address names the street, district, and country; the first parts are enough to choose. */
const PLACE_NAME_PARTS = 3;

const resultsSchema = z.array(
  z.object({ lat: z.coerce.number(), lon: z.coerce.number(), display_name: z.string() }),
);
type Result = z.infer<typeof resultsSchema>[number];

/**
 * OpenStreetMap Nominatim search under its usage policy: an identifying user agent, one request a
 * second, and a cache. The cache stays in memory: confirmed landmarks already persist in the shop's
 * landmark memory, which is checked first, and the queries are customers' own words, which Buchi
 * keeps out of the database. Misses are cached too, so a repeated unknown name is not sent again.
 */
export class Nominatim implements Geocoder, PlaceFinder {
  private readonly spacer: RequestSpacer;
  private readonly cache: TtlCache<Coordinates | null>;
  private readonly placesCache: TtlCache<Place[]>;

  constructor(
    private readonly userAgent: string,
    private readonly fetch: typeof globalThis.fetch,
    clock: { now: () => Date; wait: (ms: number) => Promise<void> },
  ) {
    this.spacer = new RequestSpacer(MIN_INTERVAL_MS, clock.now, clock.wait);
    const cacheOptions = { ttlMs: CACHE_TTL_MS, maxEntries: MAX_CACHED_SEARCHES, now: clock.now };
    this.cache = new TtlCache(cacheOptions);
    this.placesCache = new TtlCache(cacheOptions);
  }

  async search(query: string): Promise<Coordinates | undefined> {
    const cached = this.cache.get(query);
    if (cached !== undefined) return cached ?? undefined;
    const [first] = await this.spacer.run(() =>
      this.request({
        q: query,
        limit: '1',
        countrycodes: 'et',
        viewbox: ADDIS_ABABA_VIEWBOX,
        bounded: '1',
      }),
    );
    const found = first && { latitude: first.lat, longitude: first.lon };
    this.cache.set(query, found ?? null);
    return found;
  }

  /** Places anywhere in Ethiopia, because a shop or a customer can be outside Addis Ababa. */
  async searchPlaces(query: string): Promise<Place[]> {
    const cached = this.placesCache.get(query);
    if (cached) return cached;
    const results = await this.spacer.run(() =>
      this.request({ q: query, limit: String(MAX_PLACES), countrycodes: 'et' }),
    );
    const places = results.map(toPlace);
    this.placesCache.set(query, places);
    return places;
  }

  private async request(params: Record<string, string>): Promise<Result[]> {
    const url = new URL(SEARCH_URL);
    url.search = new URLSearchParams({ ...params, format: 'jsonv2' }).toString();
    const response = await this.fetch(url, {
      headers: { 'user-agent': this.userAgent, accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Nominatim answered ${String(response.status)}`);
    return resultsSchema.parse(await response.json());
  }
}

function toPlace(result: Result): Place {
  const name = result.display_name.split(',').slice(0, PLACE_NAME_PARTS).join(',').trim();
  return { name, latitude: result.lat, longitude: result.lon };
}
