import { z } from 'zod';
import type { CustomersService } from '../../../../modules/customers/customers.service';
import type { LandmarkService } from '../../../../modules/delivery/landmarks.service';
import { checkPin } from '../../../../modules/delivery/location.domain';
import type { PlaceCandidate } from '../../../../telegram/customer-chat';
import { defineTool, type Tool } from '../../../tool';
import { customerOf } from './customer';

/** Shows a found place for the customer to confirm, or asks for a pin. */
interface PlaceChat {
  confirmPlace(chatId: number, place: PlaceCandidate): Promise<void>;
  askForPin(chatId: number, text: string): Promise<void>;
}

export interface LocationToolDeps {
  customers: Pick<CustomersService, 'byTelegramUser'>;
  landmarks: Pick<LandmarkService, 'find'>;
  chat: PlaceChat;
}

const notFound = 'ቦታውን አላገኘሁትም / I could not find that place. Please share the exact pin.';

/**
 * Turns a landmark address into a candidate pin. The customer confirms it with a button, and only
 * a confirmed pin reaches the order and the shop's landmark memory.
 */
export function setLocationTool(deps: LocationToolDeps): Tool {
  return defineTool({
    name: 'set_location',
    description:
      'Finds the delivery place from a landmark the customer named, such as landmark "Edna Mall" ' +
      'in area "Bole". The customer then sees the place on a map with a confirm button, or a ' +
      'request for an exact pin when the place is not found.',
    agents: ['sales'],
    autonomy: 'automatic',
    input: z.object({
      landmark: z.string().trim().min(2).max(100),
      area: z.string().trim().min(2).max(60),
    }),
    handle: async ({ landmark, area }, context) => {
      const customer = await customerOf(deps.customers, context);
      const match = await deps.landmarks.find(context.shopId, { name: landmark, area });
      const pin = match && checkPin(match.coordinates);
      if (pin?.status !== 'found') {
        await deps.chat.askForPin(customer.telegramUserId, notFound);
        return {
          status: 'ok',
          output: { found: false, next: 'The customer was asked for a pin.' },
        };
      }
      await deps.chat.confirmPlace(customer.telegramUserId, {
        name: landmark,
        area,
        coordinates: pin.coordinates,
      });
      return {
        status: 'ok',
        output: { found: true, next: 'The customer sees the place with a confirm button.' },
      };
    },
  });
}
