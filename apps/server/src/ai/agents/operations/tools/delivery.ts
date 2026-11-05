import { z } from 'zod';
import type { AreaNoteService } from '../../../../modules/delivery/area-notes.service';
import type { TripDetails } from '../../../../modules/drivers/trip-details.service';
import type { DeliveryRescheduler } from '../../../../modules/operations/rescheduling.service';
import type { OrderService } from '../../../../modules/orders/orders.service';
import { AppError } from '../../../../shared/errors';
import { addisClockTime } from '../../../../shared/time';
import { defineTool, type Tool } from '../../../tool';

export interface DeliveryToolDeps {
  rescheduler: Pick<DeliveryRescheduler, 'reschedule'>;
  trips: Pick<TripDetails, 'trip'>;
  orders: Pick<OrderService, 'get'>;
  areaNotes: Pick<AreaNoteService, 'addDriverReport'>;
}

/** A customer who is not answering gets at most half an hour before the order moves. */
const MAX_WAIT_MINUTES = 30;

export function rescheduleDeliveryTool(deps: DeliveryToolDeps): Tool {
  return defineTool({
    name: 'reschedule_delivery',
    description:
      'Moves an order on the way to the next Saver run, and tells its customer and driver. With ' +
      'waitMinutes above 0, it moves only if the customer has not written by then.',
    agents: ['operations'],
    autonomy: 'automatic',
    input: z.object({
      orderId: z.uuid(),
      waitMinutes: z.number().int().min(0).max(MAX_WAIT_MINUTES),
    }),
    handle: async ({ orderId, waitMinutes }, context) => {
      const order = await deps.orders.get(context.shopId, orderId);
      if (order.status !== 'out_for_delivery') {
        throw new AppError('CONFLICT', 'Only an order on the way can be rescheduled.');
      }
      const at = await deps.rescheduler.reschedule(context.shopId, orderId, waitMinutes);
      return {
        status: 'ok',
        output: waitMinutes === 0 ? { rescheduled: true } : { movesAt: addisClockTime(at) },
      };
    },
  });
}

/**
 * The note belongs to the zone of the trip's next stop: drivers report where they are heading,
 * and Buchi never stores where a driver is.
 */
export function saveAreaNoteTool(deps: DeliveryToolDeps): Tool {
  return defineTool({
    name: 'save_area_note',
    description:
      "Saves what a driver reported about the road near the trip's next stop, such as roadworks " +
      'or a jam, as evidence for later delivery prices. validHours is how long it will matter.',
    agents: ['operations'],
    autonomy: 'automatic',
    input: z.object({
      jobId: z.uuid(),
      note: z.string().trim().min(3).max(200),
      validHours: z.number().int().min(1).max(168),
    }),
    handle: async ({ jobId, note, validHours }, context) => {
      const trip = await deps.trips.trip(context.shopId, jobId);
      const next = trip?.stops.find((stop) => !stop.delivered);
      if (!next) throw new AppError('CONFLICT', 'This trip has no stop left.');
      const order = await deps.orders.get(context.shopId, next.orderId);
      if (order.deliveryLatitude === null || order.deliveryLongitude === null) {
        throw new Error('A delivery order has no pin');
      }
      const near = { latitude: order.deliveryLatitude, longitude: order.deliveryLongitude };
      await deps.areaNotes.addDriverReport(context.shopId, { near, note, validHours });
      return { status: 'ok', output: { saved: true } };
    },
  });
}
