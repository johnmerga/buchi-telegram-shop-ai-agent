import { Money, type DeliverySettings } from '@buchi/shared';
import { timeBand, type SyntheticLeg } from '../delivery/factors.domain';
import { tripCost } from '../delivery/fees.domain';
import type { Coordinates } from '../delivery/location.domain';
import { zoneOf } from '../delivery/zones.domain';
import { scaled, type SyntheticFarTrip } from './far-quotes.domain';

const DAY_MS = 24 * 60 * 60_000;
const KM_PER_DEGREE = 111.195;
/** The same road detour and speed as the straight-line route estimate. */
const ROAD_DETOUR = 1.4;
const SPEED_KMH = 25;
const PRICE_STEP = Money.of('10');
const ADDIS_ABABA_OFFSET_MS = 3 * 60 * 60_000;

/**
 * The made-up truth behind the synthetic trips, by direction from the shop: the south (Kality) is
 * slow and drivers ask more to go there, the north is quicker and cheaper. Rush hour adds a quarter.
 */
const directions = [
  { from: 315, to: 45, time: 1.15, acceptance: 1.2 },
  { from: 45, to: 135, time: 1.25, acceptance: 1.3 },
  { from: 135, to: 225, time: 1.6, acceptance: 1.5 },
  { from: 225, to: 315, time: 1.4, acceptance: 1.35 },
] as const;
const PEAK_SLOWDOWN = 1.25;

export interface SyntheticTrip {
  destination: Coordinates;
  leg: SyntheticLeg;
  far: SyntheticFarTrip;
}

/**
 * Seeded synthetic far trips from a shop, spread over the last 120 days between the standard and
 * the far range. The same seed always gives the same trips, IDs included, so a backtest and its
 * recorded model answers repeat exactly.
 */
export function syntheticTrips(input: {
  origin: Coordinates;
  settings: DeliverySettings;
  now: Date;
  count: number;
  seed: number;
}): SyntheticTrip[] {
  const random = seededRandom(input.seed);
  const trips = Array.from({ length: input.count }, () => synthesize(input, random));
  return trips.sort((a, b) => a.leg.startedAt.getTime() - b.leg.startedAt.getTime());
}

function synthesize(
  input: { origin: Coordinates; settings: DeliverySettings; now: Date },
  random: () => number,
): SyntheticTrip {
  const { origin, settings, now } = input;
  const bearing = random() * 360;
  const km = settings.standardRangeKm + random() * (settings.farRangeKm - settings.standardRangeKm);
  const destination = offset(origin, bearing, km / ROAD_DETOUR);
  const routeMeters = Math.round(km * 1000);
  const routingSeconds = Math.round((km / SPEED_KMH) * 3600);
  const startedAt = localHour(new Date(now.getTime() - random() * 120 * DAY_MS), 7 + random() * 14);
  const truth = directionOf(bearing);
  const slowdown = timeBand(startedAt) === 'peak' ? PEAK_SLOWDOWN : 1;
  const actualSeconds = Math.round(routingSeconds * truth.time * slowdown * noise(random, 0.12));

  const payout = tripCost(
    [{ meters: routeMeters, seconds: routingSeconds, timeFactor: 1 }],
    settings,
  ).payout;
  const held = scaled(payout, truth.acceptance * noise(random, 0.08)).roundUpTo(PRICE_STEP);
  const raises = Math.floor(random() * 3);
  const first = scaled(held, 1 / 1.1 ** raises).roundUpTo(PRICE_STEP);
  const zone = zoneOf(destination);
  return {
    destination,
    leg: { zone, startedAt, routingSeconds, actualSeconds },
    far: {
      id: uuidFrom(random),
      zone,
      routeMeters,
      routingSeconds,
      formulaPayout: payout.toString(),
      cap: settings.farCap,
      firstPrice: (first.compare(payout) < 0 ? payout : first).toString(),
      heldPrice: held.toString(),
      raises,
      at: startedAt,
    },
  };
}

function directionOf(bearing: number): (typeof directions)[number] {
  const found = directions.find(({ from, to }) =>
    from < to ? bearing >= from && bearing < to : bearing >= from || bearing < to,
  );
  return found ?? directions[0];
}

/** Moves a point by a distance along a bearing, close enough over a city. */
function offset(point: Coordinates, bearing: number, km: number): Coordinates {
  const radians = (bearing * Math.PI) / 180;
  const latitude = point.latitude + (km * Math.cos(radians)) / KM_PER_DEGREE;
  const longitude =
    point.longitude +
    (km * Math.sin(radians)) / (KM_PER_DEGREE * Math.cos((point.latitude * Math.PI) / 180));
  return { latitude, longitude };
}

/** The same day at a given Addis Ababa hour, such as 8.5 for 08:30. */
function localHour(day: Date, hour: number): Date {
  const local = day.getTime() + ADDIS_ABABA_OFFSET_MS;
  const midnight = local - (local % DAY_MS);
  return new Date(midnight + hour * 60 * 60_000 - ADDIS_ABABA_OFFSET_MS);
}

/** A log-normal factor around 1, with `sigma` as the spread of its logarithm. */
function noise(random: () => number, sigma: number): number {
  const gaussian = Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
  return Math.exp(sigma * gaussian);
}

/** Mulberry32: a small, fast generator that repeats exactly for a seed. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function uuidFrom(random: () => number): string {
  const hex = Array.from({ length: 32 }, () => Math.floor(random() * 16).toString(16)).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
