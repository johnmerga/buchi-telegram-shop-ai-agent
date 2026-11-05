import { Money, moneySchema } from '@buchi/shared';
import { z } from 'zod';
import type { CatalogService } from '../../../../modules/catalog/catalog.service';
import type { CustomersService } from '../../../../modules/customers/customers.service';
import type { NegotiationService } from '../../../../modules/sales/negotiation.service';
import { evidenceKinds } from '../../../../modules/sales/sales.domain';
import { AppError } from '../../../../shared/errors';
import type { PolicyGuard } from '../../../guard/policy-guard.service';
import { defineTool, type Tool } from '../../../tool';
import { customerOf } from './customer';

export interface OfferPriceDeps {
  catalog: Pick<CatalogService, 'activeProducts'>;
  customers: Pick<CustomersService, 'byTelegramUser'>;
  negotiations: Pick<NegotiationService, 'state' | 'recordOffer'>;
  guard: Pick<PolicyGuard, 'checkNegotiatedPrice'>;
}

/**
 * The only way the sales agent names a price for a negotiable product. Every offer passes the
 * policy guard, and an accepted one becomes the price of the customer's cart. A fixed-price product
 * is refused here in code, whatever the model was persuaded to try.
 */
export function offerPriceTool(deps: OfferPriceDeps): Tool {
  return defineTool({
    name: 'offer_price',
    description:
      'Offers the customer a price for a negotiable product. Call it before you say any price. ' +
      "An accepted price becomes the price of the customer's cart. A rejected one comes with a " +
      'counteroffer you may offer instead. Cite the evidence IDs from search_products you used.',
    agents: ['sales'],
    autonomy: 'automatic',
    input: z.object({
      productId: z.uuid(),
      price: moneySchema,
      reason: z.string().trim().min(1).max(200),
      evidenceIds: z.array(z.enum(evidenceKinds)).max(evidenceKinds.length),
    }),
    handle: async ({ productId, price, reason, evidenceIds }, context) => {
      const customer = await customerOf(deps.customers, context);
      const [product] = await deps.catalog.activeProducts(context.shopId, [productId]);
      if (!product) throw new AppError('NOT_FOUND', 'There is no such product.');
      if (product.pricingMode === 'fixed' || product.lowestPrice === null) {
        throw new AppError(
          'CONFLICT',
          `${product.title} has a fixed price of ${product.price} birr, which is never discounted.`,
        );
      }

      const key = { shopId: context.shopId, customerId: customer.id, productId };
      const { decision, toolResult } = await deps.guard.checkNegotiatedPrice(
        context,
        { value: Money.of(price), reason, evidenceIds },
        { asking: Money.of(product.price), lowest: Money.of(product.lowestPrice) },
        await deps.negotiations.state(key),
      );
      if (decision.result === 'accepted') {
        await deps.negotiations.recordOffer(key, decision.value, decision.reason === 'concession');
      }
      return toolResult;
    },
  });
}
