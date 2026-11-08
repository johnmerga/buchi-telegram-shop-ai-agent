import { z } from 'zod';
import type {
  CatalogService,
  ProductWithVariants,
} from '../../../../modules/catalog/catalog.service';
import type { ProductSearch } from '../../../../modules/catalog/product-search.service';
import type { CustomersService } from '../../../../modules/customers/customers.service';
import type { DemandService } from '../../../../modules/demand/demand.service';
import type { PriceEvidenceService } from '../../../../modules/sales/price-evidence.service';
import type { PriceEvidence } from '../../../../modules/sales/sales.domain';
import { AppError } from '../../../../shared/errors';
import { defineTool, type Tool } from '../../../tool';
import { customerOf } from './customer';

const MAX_RESULTS = 5;

export interface CatalogToolDeps {
  catalog: Pick<CatalogService, 'variantForSale'>;
  productSearch: Pick<ProductSearch, 'search'>;
  customers: Pick<CustomersService, 'byTelegramUser'>;
  evidence: Pick<PriceEvidenceService, 'evidence'>;
  demand: Pick<DemandService, 'joinWaitlist'>;
}

/** What the model may read about a product: never the lowest price of a negotiable one. */
function productForModel(product: ProductWithVariants, evidence: PriceEvidence | undefined) {
  const pricing =
    product.pricingMode === 'fixed'
      ? { pricing: 'fixed', price: product.price }
      : { pricing: 'negotiable', askingPrice: product.price, evidence };
  return {
    productId: product.id,
    title: product.title,
    description: product.description,
    ...pricing,
    sizes: product.variants.map((variant) => ({
      variantId: variant.id,
      size: variant.size,
      color: variant.color,
      available: Math.max(0, variant.stock - variant.reserved),
    })),
  };
}

export function searchProductsTool(deps: CatalogToolDeps): Tool {
  return defineTool({
    name: 'search_products',
    description:
      'Searches the shop by words such as a product name, kind, brand, or color, in English or ' +
      'Amharic. Returns products with sizes, stock, and prices. Negotiable products come with an ' +
      'asking price and the evidence for offer_price. An empty query lists the newest products.',
    agents: ['sales'],
    autonomy: 'automatic',
    input: z.object({ query: z.string().trim().max(100) }),
    handle: async ({ query }, context) => {
      const customer = await customerOf(deps.customers, context);
      const found = await deps.productSearch.search(context.shopId, query, MAX_RESULTS);
      const products = await Promise.all(
        found.map(async (product) =>
          productForModel(
            product,
            product.pricingMode === 'negotiable'
              ? await deps.evidence.evidence(context.shopId, customer, product)
              : undefined,
          ),
        ),
      );
      return { status: 'ok', output: { products } };
    },
  });
}

export function joinWaitlistTool(deps: CatalogToolDeps): Tool {
  return defineTool({
    name: 'join_waitlist',
    description:
      'Puts the customer on the waitlist for a sold-out size, so the shop messages them when it ' +
      'is back in stock.',
    agents: ['sales'],
    autonomy: 'automatic',
    input: z.object({ variantId: z.uuid() }),
    handle: async ({ variantId }, context) => {
      const customer = await customerOf(deps.customers, context);
      const forSale = await deps.catalog.variantForSale(context.shopId, variantId);
      if (!forSale) throw new AppError('NOT_FOUND', 'There is no such size.');
      const { variant } = forSale;
      if (variant.stock > variant.reserved) {
        throw new AppError(
          'CONFLICT',
          `Size ${variant.size} is in stock. Use update_cart instead.`,
        );
      }
      await deps.demand.joinWaitlist(context.shopId, customer.id, variantId);
      return { status: 'ok', output: { joined: true } };
    },
  });
}
