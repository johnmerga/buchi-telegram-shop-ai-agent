import { createHash, createHmac } from 'node:crypto';

type Fields = Record<string, string | number>;

/**
 * Signs Login Widget data the way Telegram does. `mini-app` signs it with the Mini App key
 * instead, to show that one kind of signature cannot pass as the other.
 */
export function signLoginWidget(
  fields: Fields,
  botToken: string,
  key: 'login-widget' | 'mini-app' = 'login-widget',
): Fields & { hash: string } {
  const dataCheckString = Object.keys(fields)
    .sort()
    .map((name) => `${name}=${String(fields[name])}`)
    .join('\n');
  const secretKey =
    key === 'login-widget'
      ? createHash('sha256').update(botToken).digest()
      : createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  return { ...fields, hash };
}
