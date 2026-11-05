import { createHmac } from 'node:crypto';

/** Signs Mini App launch data the way Telegram does, so tests can build valid and tampered input. */
export function signInitData(fields: Record<string, string>, botToken: string): string {
  const dataCheckString = Object.keys(fields)
    .sort()
    .map((key) => `${key}=${fields[key] ?? ''}`)
    .join('\n');
  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  return new URLSearchParams({ ...fields, hash }).toString();
}

/** Typical launch data for a user, signed `ageSeconds` before `now`. */
export function launchFields(userId: number, now: Date, ageSeconds = 60): Record<string, string> {
  return {
    auth_date: String(Math.floor(now.getTime() / 1000) - ageSeconds),
    query_id: 'AAHdF6IQAAAAAN0XohDhrOrc',
    signature: 'c2lnbmF0dXJlLWZyb20tYm90LWFwaS04',
    user: JSON.stringify({ id: userId, first_name: 'Abebe', username: 'abebe' }),
  };
}
