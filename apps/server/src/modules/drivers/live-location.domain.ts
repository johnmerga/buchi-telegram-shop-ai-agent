import type { Coordinates } from '../delivery/location.domain';
import { point } from './dispatch.domain';

/** Telegram's `live_period` for a Live Location shared until the sender stops it. */
export const INDEFINITE_LIVE_PERIOD = 0x7fffffff;

/** Telegram accepts a bot's live period from one minute to one day, or indefinite. */
const MIN_LIVE_SECONDS = 60;
const MAX_LIVE_SECONDS = 24 * 60 * 60;

/** A point older than this no longer shows where the driver is, so **Delivered** asks again. */
export const LIVE_FRESH_MS = 2 * 60_000;

/**
 * Phones send a moving Live Location every few seconds. Customers' maps follow at most this
 * often, which keeps the edits well inside Telegram's limits.
 */
export const LIVE_UPDATE_GAP_MS = 10_000;

/** A driver's Live Location as Telegram reports it: a point, or sharing that has stopped. */
export type LiveShare = { point: Coordinates; until: Date | null } | { stopped: true };

/**
 * A Live Location message as a share. Telegram counts `live_period` from the message's date, and
 * an edit without it means the driver stopped sharing.
 */
export function liveShareOf(message: {
  date: number;
  location: { latitude: number; longitude: number; live_period?: number };
}): LiveShare {
  const { latitude, longitude, live_period: period } = message.location;
  if (period === undefined) return { stopped: true };
  const until = period === INDEFINITE_LIVE_PERIOD ? null : new Date((message.date + period) * 1000);
  return { point: { latitude, longitude }, until };
}

/** The live period for a customer's map: as long as the driver still shares, within Telegram's range. */
export function customerLivePeriod(until: Date | null, now: Date): number {
  if (until === null) return INDEFINITE_LIVE_PERIOD;
  const seconds = Math.round((until.getTime() - now.getTime()) / 1000);
  return Math.min(Math.max(seconds, MIN_LIVE_SECONDS), MAX_LIVE_SECONDS);
}

/** Whether an update comes soon enough after the last one that it can be skipped. */
export function tooSoon(lastAt: Date | null, now: Date): boolean {
  return lastAt !== null && now.getTime() - lastAt.getTime() < LIVE_UPDATE_GAP_MS;
}

/** The trip's live point, when it is recent and the driver is still sharing. */
export function freshLivePoint(
  job: {
    liveLatitude: number | null;
    liveLongitude: number | null;
    liveAt: Date | null;
    liveUntil: Date | null;
  },
  now: Date,
): Coordinates | null {
  const { liveAt, liveUntil } = job;
  if (liveAt === null || now.getTime() - liveAt.getTime() > LIVE_FRESH_MS) return null;
  if (liveUntil !== null && liveUntil.getTime() <= now.getTime()) return null;
  return point(job.liveLatitude, job.liveLongitude);
}
