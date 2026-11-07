import { createHash } from 'node:crypto';
import type { DriverWork } from '@buchi/shared';
import { orderReference } from '../orders/orders.domain';

/** Long enough for the owner to forward the link and the driver to open it the next day. */
export const INVITE_TTL_MS = 48 * 60 * 60_000;

/** Why an invite link did not link the person who opened it. */
export type InviteProblem = 'invalid' | 'expired' | 'wrong_user';

export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * The invite is for one Telegram username, so a forwarded link does not make someone else a
 * driver. Telegram ignores case in usernames.
 */
export function checkInvite(
  invite: { username: string; expiresAt: Date },
  opener: { username: string | undefined },
  now: Date,
): InviteProblem | undefined {
  if (invite.expiresAt <= now) return 'expired';
  if (opener.username?.toLowerCase() !== invite.username) return 'wrong_user';
  return undefined;
}

/**
 * The name customers see for a driver. A Telegram name can be only symbols, such as ".", so a
 * name without a letter falls back to the username the owner invited.
 */
export function driverDisplayName(driver: { name: string | null; username: string }): string {
  const { name } = driver;
  return name !== null && /\p{L}/u.test(name) ? name.trim() : `@${driver.username}`;
}

/** An undelivered stop on a driver's accepted job. */
export interface OpenStop {
  driverId: string;
  jobStatus: 'assigned' | 'picked_up';
  orderId: string;
}

/**
 * Each driver's current work, from open stops in the order the driver handles them: the first
 * stop is the one they are heading to now.
 */
export function currentWork(stops: OpenStop[]): Map<string, DriverWork> {
  const work = new Map<string, DriverWork>();
  for (const stop of stops) {
    if (work.has(stop.driverId)) continue;
    work.set(stop.driverId, {
      stage: stop.jobStatus === 'picked_up' ? 'delivering' : 'to_pickup',
      orderReference: orderReference(stop.orderId),
    });
  }
  return work;
}
