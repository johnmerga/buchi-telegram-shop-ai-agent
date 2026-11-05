import { z } from 'zod';

/**
 * A Telegram username such as "@abebe_rides". Telegram ignores case in usernames, so it is stored
 * in lowercase without the "@".
 */
export const driverInviteSchema = z.object({
  username: z
    .string()
    .trim()
    .regex(/^@?[A-Za-z][A-Za-z0-9_]{4,31}$/, 'Use a Telegram username such as @abebe_rides.')
    .transform((username) => username.replace(/^@/, '').toLowerCase()),
});
export type DriverInvite = z.infer<typeof driverInviteSchema>;
