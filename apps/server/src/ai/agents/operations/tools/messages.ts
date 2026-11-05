import { z } from 'zod';
import type { TripDetails } from '../../../../modules/drivers/trip-details.service';
import type {
  CustomerMessages,
  MessageResult,
} from '../../../../modules/operations/customer-messages.service';
import { driverContact, newArrivalTime } from '../../../../modules/operations/operations.domain';
import type { Messenger } from '../../../../modules/owner/owner-notifier.service';
import { AppError } from '../../../../shared/errors';
import { addisClockTime } from '../../../../shared/time';
import { defineTool, type Tool } from '../../../tool';

export interface MessageToolDeps {
  customerMessages: Pick<CustomerMessages, 'toOrderCustomer'>;
  trips: Pick<TripDetails, 'trip' | 'tripOfOrder'>;
  messenger: Pick<Messenger, 'send'>;
  now: () => Date;
}

const text = z.string().trim().min(1).max(500);

/** The model never sees a phone number, so code adds the driver's when the agent asks for it. */
export function messageCustomerTool(deps: MessageToolDeps): Tool {
  return defineTool({
    name: 'message_customer',
    description:
      "Sends the order's customer a message in their chat with the shop. Set includeDriverPhone " +
      "to add the driver's name and phone number below your text.",
    agents: ['operations'],
    autonomy: 'automatic',
    input: z.object({ orderId: z.uuid(), text, includeDriverPhone: z.boolean().default(false) }),
    handle: async ({ orderId, text: body, includeDriverPhone }, context) => {
      let message = body;
      if (includeDriverPhone) {
        const driver = (await deps.trips.tripOfOrder(context.shopId, orderId))?.driver;
        if (!driver || driver.phone === null) {
          throw new AppError('CONFLICT', 'This order has no driver with a phone number.');
        }
        message = `${body}\n${driverContact({ name: driver.name, phone: driver.phone })}`;
      }
      requireSent(await deps.customerMessages.toOrderCustomer(context.shopId, orderId, message));
      return { status: 'ok', output: { sent: true } };
    },
  });
}

export function messageDriverTool(deps: MessageToolDeps): Tool {
  return defineTool({
    name: 'message_driver',
    description: 'Sends the driver of a trip a message in their chat with Buchi.',
    agents: ['operations'],
    autonomy: 'automatic',
    input: z.object({ jobId: z.uuid(), text }),
    handle: async ({ jobId, text: body }, context) => {
      const driver = (await deps.trips.trip(context.shopId, jobId))?.driver;
      if (!driver) throw new AppError('CONFLICT', 'This trip has no driver yet.');
      try {
        await deps.messenger.send(driver.telegramUserId, `💬 ${body}`, []);
      } catch {
        // The Telegram error holds the request with the text, so it is not passed on.
        throw new AppError('CONFLICT', 'Telegram did not deliver the message to the driver.');
      }
      return { status: 'ok', output: { sent: true } };
    },
  });
}

/** Code writes the arrival time from the minutes, so the customer never reads a guessed clock. */
export function updateEtaTool(deps: MessageToolDeps): Tool {
  return defineTool({
    name: 'update_eta',
    description:
      'Tells the customer of an order on the way when it should now arrive, from the minutes ' +
      'the delivery still needs.',
    agents: ['operations'],
    autonomy: 'automatic',
    input: z.object({ orderId: z.uuid(), minutes: z.number().int().min(1).max(240) }),
    handle: async ({ orderId, minutes }, context) => {
      const arrival = new Date(deps.now().getTime() + minutes * 60_000);
      const text = newArrivalTime(orderId, arrival);
      requireSent(await deps.customerMessages.toOrderCustomer(context.shopId, orderId, text));
      return { status: 'ok', output: { arrivalTime: addisClockTime(arrival) } };
    },
  });
}

/** While an owner answers the customer, Buchi stays quiet, and the agent hears why. */
export function requireSent(delivery: MessageResult): void {
  if (delivery === 'owner_answering') {
    throw new AppError('CONFLICT', 'The owner is answering this customer, so Buchi stays quiet.');
  }
}
