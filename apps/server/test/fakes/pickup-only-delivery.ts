import type { DeliveryService } from '../../src/modules/delivery/delivery.service';

/** A shop without delivery settings: checkout goes straight to a pickup order. */
export const pickupOnlyDelivery: Pick<DeliveryService, 'offersDelivery' | 'quote'> = {
  offersDelivery: () => Promise.resolve(false),
  quote: () => Promise.resolve(undefined),
};
