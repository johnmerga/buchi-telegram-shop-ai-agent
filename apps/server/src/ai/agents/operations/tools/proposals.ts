import { Money, moneySchema } from '@buchi/shared';
import { z } from 'zod';
import type { CatalogService } from '../../../../modules/catalog/catalog.service';
import type { CustomersService } from '../../../../modules/customers/customers.service';
import type { DemandService } from '../../../../modules/demand/demand.service';
import type { OfferBonusService } from '../../../../modules/drivers/offer-bonus.service';
import type { CustomerMessages } from '../../../../modules/operations/customer-messages.service';
import { refundApproved, restockComing } from '../../../../modules/operations/operations.domain';
import type { OrderService } from '../../../../modules/orders/orders.service';
import type { ConversationService } from '../../../../modules/owner/conversations.service';
import { AppError } from '../../../../shared/errors';
import { defineTool, type Tool } from '../../../tool';

export interface ProposalToolDeps {
  orders: Pick<OrderService, 'get'>;
  customers: Pick<CustomersService, 'get'>;
  catalog: Pick<CatalogService, 'variantForSale'>;
  demand: Pick<DemandService, 'waitingCustomers'>;
  bonuses: Pick<OfferBonusService, 'raise'>;
  conversations: Pick<ConversationService, 'requestHuman'>;
  customerMessages: Pick<CustomerMessages, 'toOrderCustomer' | 'toCustomer'>;
}

const reason = z.string().trim().min(3).max(300);

/*
 * Every tool here is `owner_confirms`: the registry holds the call as a pending decision, and the
 * handler runs only after the owner approves it.
 */

/** Money goes back by hand, so approval tells the customer that the owner will send it. */
export function proposeRefundTool(deps: ProposalToolDeps): Tool {
  return defineTool({
    name: 'propose_refund',
    description: 'Asks the owner to refund the customer of an order. The owner approves it.',
    agents: ['operations'],
    autonomy: 'owner_confirms',
    input: z.object({ orderId: z.uuid(), amount: moneySchema, reason }),
    handle: async ({ orderId, amount }, context) => {
      const order = await deps.orders.get(context.shopId, orderId);
      if (Money.of(amount).compare(Money.of(order.total)) > 0) {
        throw new AppError('CONFLICT', 'A refund cannot be more than the order total.');
      }
      const message = refundApproved(orderId, amount);
      const told = await deps.customerMessages.toOrderCustomer(context.shopId, orderId, message);
      return { status: 'ok', output: { refunded: amount, customerTold: told === 'sent' } };
    },
  });
}

/** Stock changes only when the goods arrive, so approval tells the waiting customers instead. */
export function proposeRestockTool(deps: ProposalToolDeps): Tool {
  return defineTool({
    name: 'propose_restock',
    description:
      'Asks the owner to restock a sold-out size with a quantity. The owner approves it.',
    agents: ['operations'],
    autonomy: 'owner_confirms',
    input: z.object({ variantId: z.uuid(), quantity: z.number().int().min(1).max(1000), reason }),
    handle: async ({ variantId }, context) => {
      const { shopId } = context;
      const forSale = await deps.catalog.variantForSale(shopId, variantId);
      if (!forSale) throw new AppError('NOT_FOUND', 'This size is no longer for sale.');
      const message = restockComing({ title: forSale.product.title, size: forSale.variant.size });
      let told = 0;
      for (const customerId of await deps.demand.waitingCustomers(shopId, variantId)) {
        const customer = await deps.customers.get(shopId, customerId);
        if ((await deps.customerMessages.toCustomer(shopId, customer, message)) === 'sent') {
          told += 1;
        }
      }
      return { status: 'ok', output: { customersTold: told } };
    },
  });
}

export function proposeBonusTool(deps: ProposalToolDeps): Tool {
  return defineTool({
    name: 'propose_bonus',
    description:
      'Asks the owner to add a bonus to a job offer that no driver accepted. Once approved, the ' +
      'job is offered again at the payout plus the bonus.',
    agents: ['operations'],
    autonomy: 'owner_confirms',
    input: z.object({ offerId: z.uuid(), bonus: moneySchema, reason }),
    handle: async ({ offerId, bonus }, context) => {
      if (Money.of(bonus).compare(Money.zero) <= 0) {
        throw new AppError('VALIDATION_FAILED', 'A bonus must be more than zero.');
      }
      const raised = await deps.bonuses.raise(context.shopId, offerId, Money.of(bonus));
      if (raised.status === 'closed') {
        throw new AppError('CONFLICT', 'A driver already took this job.');
      }
      return { status: 'ok', output: { offeredAt: raised.price } };
    },
  });
}

/** Approval hands the customer's chat to the owner, who carries out the recommendation. */
export function escalateTool(deps: ProposalToolDeps): Tool {
  return defineTool({
    name: 'escalate',
    description:
      'Sends a case to the owner with a short summary and your recommendation. If the owner ' +
      "approves, they take over the order's customer chat.",
    agents: ['operations'],
    autonomy: 'owner_confirms',
    input: z.object({
      orderId: z.uuid(),
      summary: z.string().trim().min(3).max(300),
      recommendation: z.string().trim().min(3).max(300),
    }),
    handle: async ({ orderId, summary }, context) => {
      const order = await deps.orders.get(context.shopId, orderId);
      const customer = await deps.customers.get(context.shopId, order.customerId);
      await deps.conversations.requestHuman(context.shopId, customer, summary);
      return { status: 'ok', output: { handedOver: true } };
    },
  });
}
