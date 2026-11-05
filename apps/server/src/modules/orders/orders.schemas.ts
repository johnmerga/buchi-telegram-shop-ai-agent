import { deliveryTypes, type DeliveryType } from '@buchi/shared';
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

const DELIVERY_PREFIX = 'deliver:';

/** A delivery option button. `far` asks the drivers for a price instead of choosing one. */
export function deliveryChoiceCallback(type: DeliveryType): string {
  return `${DELIVERY_PREFIX}${type}`;
}

export const deliveryChoiceCallbackSchema = z
  .string()
  .startsWith(DELIVERY_PREFIX)
  .transform((data) => data.slice(DELIVERY_PREFIX.length))
  .pipe(z.enum(deliveryTypes));
