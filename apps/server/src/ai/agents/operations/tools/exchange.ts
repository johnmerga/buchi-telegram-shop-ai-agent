import { z } from 'zod';
import type { CatalogService } from '../../../../modules/catalog/catalog.service';
import type { CustomerMessages } from '../../../../modules/operations/customer-messages.service';
import { exchangeAlert, exchangeReserved } from '../../../../modules/operations/operations.domain';
import type { OrderService } from '../../../../modules/orders/orders.service';
import type { OwnerAlerts } from '../../../../modules/owner/owner-alerts.service';
import { AppError } from '../../../../shared/errors';
import { defineTool, type Tool } from '../../../tool';

export interface ExchangeToolDeps {
  orders: Pick<OrderService, 'startExchange'>;
  catalog: Pick<CatalogService, 'variantForSale'>;
  customerMessages: Pick<CustomerMessages, 'toOrderCustomer'>;
  ownerAlerts: Pick<OwnerAlerts, 'send'>;
}

/**
 * Automatic, because code reserves the new size in the order's transaction and refuses when it is
 * sold out. The owners hear about every exchange, since someone has to swap the pair.
 */
export function startExchangeTool(deps: ExchangeToolDeps): Tool {
  return defineTool({
    name: 'start_exchange',
    description:
      'Reserves one unit of another size of a delivered item for a size exchange, and tells the ' +
      'customer and the owner. It fails when the size is not available.',
    agents: ['operations'],
    autonomy: 'automatic',
    input: z.object({ orderId: z.uuid(), fromVariantId: z.uuid(), toVariantId: z.uuid() }),
    handle: async ({ orderId, fromVariantId, toVariantId }, context) => {
      const { shopId } = context;
      const [from, to] = await Promise.all([
        deps.catalog.variantForSale(shopId, fromVariantId),
        deps.catalog.variantForSale(shopId, toVariantId),
      ]);
      if (!from || !to) throw new AppError('NOT_FOUND', 'One of these sizes is not for sale.');
      await deps.orders.startExchange(shopId, { orderId, fromVariantId, toVariantId });
      const sizes = { from: from.variant.size, to: to.variant.size };
      const told = await deps.customerMessages.toOrderCustomer(
        shopId,
        orderId,
        exchangeReserved(orderId, sizes.to),
      );
      await deps.ownerAlerts.send(shopId, exchangeAlert(orderId, sizes));
      return { status: 'ok', output: { reservedSize: sizes.to, customerTold: told === 'sent' } };
    },
  });
}
