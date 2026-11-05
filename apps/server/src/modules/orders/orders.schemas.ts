import { z } from 'zod';
import type { PricedDeliveryType } from '../delivery/fees.domain';

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

const DELIVERY_PREFIX = 'deliver:';

export function deliveryChoiceCallback(type: PricedDeliveryType): string {
  return `${DELIVERY_PREFIX}${type}`;
}

/** Parses a delivery option button. Far-area delivery has no button until Task 5.6. */
export const deliveryChoiceCallbackSchema = z
  .string()
  .startsWith(DELIVERY_PREFIX)
  .transform((data) => data.slice(DELIVERY_PREFIX.length))
  .pipe(z.enum(['free', 'express', 'saver', 'pickup']));
