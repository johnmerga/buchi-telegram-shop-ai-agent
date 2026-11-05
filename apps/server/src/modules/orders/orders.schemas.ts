import { z } from 'zod';

const REORDER_PREFIX = 'reorder:';

/** Telegram limits callback data to 64 bytes, so the reorder button carries only the order ID. */
export function reorderCallbackData(orderId: string): string {
  return `${REORDER_PREFIX}${orderId}`;
}

/** Parses the reorder button's callback data into the expired order's ID. */
export const reorderCallbackSchema = z
  .string()
  .startsWith(REORDER_PREFIX)
  .transform((data) => data.slice(REORDER_PREFIX.length))
  .pipe(z.uuid());
