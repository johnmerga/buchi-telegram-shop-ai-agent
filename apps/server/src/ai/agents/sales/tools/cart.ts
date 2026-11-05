import { z } from 'zod';
import type { CatalogService } from '../../../../modules/catalog/catalog.service';
import type { CustomersService } from '../../../../modules/customers/customers.service';
import type {
  CheckoutService,
  PlaceOrderResult,
} from '../../../../modules/orders/checkout.service';
import { orderReference } from '../../../../modules/orders/orders.domain';
import type { OrderService } from '../../../../modules/orders/orders.service';
import { AppError } from '../../../../shared/errors';
import { defineTool, type Tool } from '../../../tool';
import { customerOf } from './customer';

const RECENT_ORDERS = 5;

/** Sends the next checkout step with its buttons, or the payment instructions, from code. */
interface CheckoutChat {
  orderStep(chatId: number, step: PlaceOrderResult): Promise<void>;
}

export interface CartToolDeps {
  catalog: Pick<CatalogService, 'variantForSale'>;
  customers: Pick<CustomersService, 'byTelegramUser' | 'sessionOf' | 'rememberChosenVariant'>;
  orders: Pick<OrderService, 'unitPrice' | 'recentForCustomer'>;
  checkout: Pick<CheckoutService, 'placeOrder'>;
  chat: CheckoutChat;
}

/** What the model reads after confirm_order. The customer already got the step itself. */
const nextSteps: Record<PlaceOrderResult['status'], string> = {
  needs_phone: 'The customer got a button to share their phone number.',
  needs_location: 'The customer got a button to share the delivery location.',
  placed:
    'The order is reserved and the customer got the payment instructions. Do not repeat them.',
};

export function updateCartTool(deps: CartToolDeps): Tool {
  return defineTool({
    name: 'update_cart',
    description:
      "Puts one unit of a size into the customer's cart, replacing what was there. Returns the " +
      'price the customer pays, or none while a negotiable price is not agreed yet.',
    agents: ['sales'],
    autonomy: 'automatic',
    input: z.object({ variantId: z.uuid() }),
    handle: async ({ variantId }, context) => {
      const customer = await customerOf(deps.customers, context);
      const forSale = await deps.catalog.variantForSale(context.shopId, variantId);
      if (!forSale) throw new AppError('NOT_FOUND', 'There is no such size.');
      const { product, variant } = forSale;
      if (variant.stock <= variant.reserved) {
        throw new AppError('CONFLICT', `Size ${variant.size} is sold out. Offer join_waitlist.`);
      }
      await deps.customers.rememberChosenVariant(customer.telegramUserId, variantId);
      const price = await deps.orders.unitPrice(context.shopId, customer.id, variantId);
      return {
        status: 'ok',
        output: {
          cart: { productId: product.id, title: product.title, size: variant.size },
          price: price?.toString() ?? 'not agreed yet: use offer_price',
        },
      };
    },
  });
}

export function confirmOrderTool(deps: CartToolDeps): Tool {
  return defineTool({
    name: 'confirm_order',
    description:
      "Orders the customer's cart once they confirm. Buchi then asks for the phone number and " +
      'the delivery location with buttons, reserves the stock, and sends the payment instructions.',
    agents: ['sales'],
    autonomy: 'automatic',
    input: z.object({}),
    handle: async (_input, context) => {
      const customer = await customerOf(deps.customers, context);
      const session = await deps.customers.sessionOf(customer.telegramUserId);
      const variantId = session?.pendingVariantId;
      if (!variantId) throw new AppError('CONFLICT', 'The cart is empty. Use update_cart first.');
      const buyer = { telegramUserId: customer.telegramUserId, name: customer.name };
      const step = await deps.checkout.placeOrder(context.shopId, buyer, variantId);
      await deps.chat.orderStep(customer.telegramUserId, step);
      return { status: 'ok', output: { next: nextSteps[step.status] } };
    },
  });
}

export function getMyOrdersTool(deps: CartToolDeps): Tool {
  return defineTool({
    name: 'get_my_orders',
    description: "Lists the customer's latest orders in this shop with their status and total.",
    agents: ['sales'],
    autonomy: 'automatic',
    input: z.object({}),
    handle: async (_input, context) => {
      const customer = await customerOf(deps.customers, context);
      const orders = await deps.orders.recentForCustomer(
        context.shopId,
        customer.id,
        RECENT_ORDERS,
      );
      return {
        status: 'ok',
        output: {
          orders: orders.map((order) => ({
            reference: orderReference(order.id),
            status: order.status,
            total: order.total,
            placedAt: order.createdAt.toISOString(),
          })),
        },
      };
    },
  });
}
