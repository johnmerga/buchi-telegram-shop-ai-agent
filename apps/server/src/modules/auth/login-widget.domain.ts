import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '../../shared/errors';

const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * What the Login Widget hands the page: `id`, `auth_date`, `hash`, and optional profile fields.
 * Every field Telegram sent takes part in the signature, so unknown fields are kept, not stripped.
 */
export const loginWidgetDataSchema = z.record(z.string(), z.union([z.string(), z.number()]));
export type LoginWidgetData = z.infer<typeof loginWidgetDataSchema>;

const hashSchema = z.string().regex(/^[0-9a-f]{64}$/);
const idSchema = z.coerce.number().int().positive();
const authDateSchema = z.coerce
  .number()
  .int()
  .positive()
  .transform((seconds) => seconds * 1000);

/**
 * Verifies data from the Telegram Login Widget and returns the signed-in user's Telegram ID.
 * See https://core.telegram.org/widgets/login#checking-authorization.
 */
export function verifyLoginWidget(data: LoginWidgetData, botToken: string, now: Date): number {
  const { hash: givenHash, ...fields } = data;
  const hash = hashSchema.safeParse(givenHash);
  if (!hash.success) throw unauthorized('Login data has no valid hash');

  // Unlike Mini App data, the widget's key is the plain SHA-256 of the bot token.
  const secretKey = createHash('sha256').update(botToken).digest();
  const expected = createHmac('sha256', secretKey).update(dataCheckString(fields)).digest();
  if (!timingSafeEqual(expected, Buffer.from(hash.data, 'hex'))) {
    throw unauthorized('Login data signature does not match');
  }

  const authDate = authDateSchema.safeParse(fields.auth_date);
  if (!authDate.success) throw unauthorized('Login data has no valid auth_date');
  if (now.getTime() - authDate.data > MAX_AGE_MS) throw unauthorized('Login data has expired');

  const id = idSchema.safeParse(fields.id);
  if (!id.success) throw unauthorized('Login data has no valid user ID');
  return id.data;
}

function dataCheckString(fields: Record<string, string | number>): string {
  return Object.keys(fields)
    .sort()
    .map((key) => `${key}=${String(fields[key])}`)
    .join('\n');
}

function unauthorized(message: string): AppError {
  return new AppError('UNAUTHORIZED', message);
}
