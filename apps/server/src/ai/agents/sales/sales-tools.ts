import type { Tool } from '../../tool';
import { confirmOrderTool, getMyOrdersTool, updateCartTool, type CartToolDeps } from './tools/cart';
import {
  joinWaitlistTool,
  searchProductsTool,
  showProductsTool,
  type CatalogToolDeps,
} from './tools/catalog';
import { requestHumanTool, type HumanToolDeps } from './tools/human';
import { setLocationTool, type LocationToolDeps } from './tools/location';
import { forgetMyDetailsTool, rememberFactTool, type MemoryToolDeps } from './tools/memory';
import { offerPriceTool, type OfferPriceDeps } from './tools/offer-price';

export type SalesToolDeps = CatalogToolDeps &
  CartToolDeps &
  OfferPriceDeps &
  LocationToolDeps &
  MemoryToolDeps &
  HumanToolDeps;

/** Every tool of the sales agent, in the order the model sees them. */
export function salesTools(deps: SalesToolDeps): Tool[] {
  return [
    searchProductsTool(deps),
    showProductsTool(deps),
    getMyOrdersTool(deps),
    updateCartTool(deps),
    confirmOrderTool(deps),
    offerPriceTool(deps),
    setLocationTool(deps),
    joinWaitlistTool(deps),
    rememberFactTool(deps),
    forgetMyDetailsTool(deps),
    requestHumanTool(deps),
  ];
}
