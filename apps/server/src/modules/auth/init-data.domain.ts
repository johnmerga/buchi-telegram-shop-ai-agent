import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '../../shared/errors';

const MAX_AGE_MS = 24 * 60 * 60 * 1000;

const authDateSchema = z
  .string()
  .regex(/^\d+$/)
  .transform((seconds) => Number(seconds) * 1000);
const hashSchema = z.string().regex(/^[0-9a-f]{64}$/);
const userSchema = z.object({ id: z.number().int().positive() });

/**
 * Verifies Telegram Mini App launch data and returns the signed-in user's Telegram ID.
 * See https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app.
 */
export function verifyInitData(initData: string, botToken: string, now: Date): number {
  const params = new URLSearchParams(initData);

  const hash = hashSchema.safeParse(params.get('hash'));
  if (!hash.success) throw unauthorized('initData has no valid hash');
  params.delete('hash');

  const expected = createHmac('sha256', secretKey(botToken)).update(dataCheckString(params));
  if (!timingSafeEqual(expected.digest(), Buffer.from(hash.data, 'hex'))) {
    throw unauthorized('initData signature does not match');
  }

  const authDate = authDateSchema.safeParse(params.get('auth_date'));
  if (!authDate.success) throw unauthorized('initData has no valid auth_date');
  if (now.getTime() - authDate.data > MAX_AGE_MS) throw unauthorized('initData has expired');

  const user = userSchema.safeParse(parseJson(params.get('user')));
  if (!user.success) throw unauthorized('initData has no valid user');
  return user.data.id;
}

function secretKey(botToken: string): Buffer {
  return createHmac('sha256', 'WebAppData').update(botToken).digest();
}

/** Every field except `hash`, including Bot API 8.0's `signature`, sorted by key. */
function dataCheckString(params: URLSearchParams): string {
  return [...params]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
}

function parseJson(text: string | null): unknown {
  if (text === null) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function unauthorized(message: string): AppError {
  return new AppError('UNAUTHORIZED', message);
}
