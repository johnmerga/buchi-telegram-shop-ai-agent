import { z } from 'zod';
import { orderStatusSchema } from './enums';

/** A change that the server pushes to the owner's open dashboards over Server-Sent Events. */
export const liveEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('order.created'), orderId: z.uuid() }),
  z.object({
    type: z.literal('order.transitioned'),
    orderId: z.uuid(),
    from: orderStatusSchema,
    to: orderStatusSchema,
  }),
]);
export type LiveEvent = z.infer<typeof liveEventSchema>;
