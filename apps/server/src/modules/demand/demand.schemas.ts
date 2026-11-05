import { z } from 'zod';

const NOTIFY_PREFIX = 'notify:';

/** Telegram limits callback data to 64 bytes, so **Notify me** carries only the signal's ID. */
export function notifyCallbackData(signalId: string): string {
  return `${NOTIFY_PREFIX}${signalId}`;
}

export const notifyCallbackSchema = z
  .string()
  .startsWith(NOTIFY_PREFIX)
  .transform((data) => data.slice(NOTIFY_PREFIX.length))
  .pipe(z.uuid());
