import { createHash } from 'node:crypto';

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
