import type { DeliveryPauses } from '../../src/modules/delivery/delivery.service';
import type { Promotions } from '../../src/modules/orders/orders.service';

/** For tests without owner rules: no promotion changes a price. */
export const noPromotions: Promotions = { activePromotions: () => Promise.resolve([]) };

/** For tests without owner rules: deliveries are never paused. */
export const noPauses: DeliveryPauses = { deliveryPaused: () => Promise.resolve(false) };
