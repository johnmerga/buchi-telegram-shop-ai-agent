import { z } from 'zod';

/** A signed-in session: the bearer token for the API and when it stops working. */
export const sessionSchema = z.object({ token: z.string().min(1), expiresAt: z.iso.datetime() });
export type Session = z.infer<typeof sessionSchema>;

export const loginWidgetConfigSchema = z.object({ botUsername: z.string().min(1) });
