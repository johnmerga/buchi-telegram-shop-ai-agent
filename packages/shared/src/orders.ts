import { z } from 'zod';
import { deliveryTypeSchema, orderStatusSchema } from './enums';
import { moneySchema } from './money';

export const orderLineSchema = z.object({
  title: z.string(),
  size: z.string(),
  quantity: z.number().int().positive(),
});
export type OrderLine = z.infer<typeof orderLineSchema>;

/** An order on the owner's live board. */
export const orderBoardItemSchema = z.object({
  id: z.uuid(),
  status: orderStatusSchema,
  deliveryType: deliveryTypeSchema,
  total: moneySchema,
  deliveryFee: moneySchema,
  customerName: z.string(),
  paymentDeadline: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  lines: z.array(orderLineSchema),
});
export type OrderBoardItem = z.infer<typeof orderBoardItemSchema>;

/** A customer's own order, for tracking it in the customer Mini App. */
export const trackedOrderSchema = z.object({
  id: z.uuid(),
  shopName: z.string(),
  status: orderStatusSchema,
  deliveryType: deliveryTypeSchema,
  total: moneySchema,
  deliveryFee: moneySchema,
  paymentDeadline: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  lines: z.array(orderLineSchema),
});
export type TrackedOrder = z.infer<typeof trackedOrderSchema>;
