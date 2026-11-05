import { formatBirr, type MoneyString, type PricingMode } from '@buchi/shared';
import type { Button } from '../owner/owner.domain';
import type { ProductPhoto } from './catalog.schemas';

export interface PostableProduct {
  title: string;
  description: string;
  pricingMode: PricingMode;
  price: MoneyString;
}

export interface VariantStock {
  size: string;
  stock: number;
  reserved: number;
}

export interface PostContent {
  caption: string;
  buttonText: string;
}

const START_PREFIX = 'p_';

/** Sizes that a customer can still buy, in natural order such as 39, 40, 41, M, L. */
export function availableSizes(variants: VariantStock[]): string[] {
  const sizes = new Set(variants.filter((v) => v.stock > v.reserved).map((v) => v.size));
  return [...sizes].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/** A negotiable product never shows its price, so the agent can negotiate in private. */
export function postContent(product: PostableProduct, sizes: string[]): PostContent {
  const priceLine =
    product.pricingMode === 'fixed'
      ? `ዋጋ / Price: ${formatBirr(product.price)}`
      : 'ዋጋ ለመጠየቅ ከታች ይጫኑ / Tap below to ask the price';
  const caption = [
    product.title,
    product.description,
    `መጠን / Sizes: ${sizes.join(', ')}`,
    priceLine,
  ]
    .filter((line) => line !== '')
    .join('\n\n');
  return {
    caption,
    buttonText: product.pricingMode === 'fixed' ? 'ግዛ / Buy' : 'ዋጋ ጠይቅ / Ask price',
  };
}

/** Telegram allows 64 characters of [A-Za-z0-9_-] after `start=`, so the UUID loses its dashes. */
export function buyLink(botUsername: string, postId: string): string {
  return `https://t.me/${botUsername}?start=${START_PREFIX}${postId.replaceAll('-', '')}`;
}

/** Returns the channel post ID from a `/start` payload, or undefined for any other payload. */
export function postIdFromStartPayload(payload: string): string | undefined {
  const match = /^p_([0-9a-f]{8})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{12})$/.exec(
    payload,
  );
  return match ? match.slice(1).join('-') : undefined;
}

export interface CardProduct extends PostableProduct {
  variants: (VariantStock & { id: string; color: string | null })[];
}

/**
 * The product card a customer sees in the chat, with one button per size in stock. A negotiable
 * product shows no price: the customer agrees it with the sales agent.
 */
export function productCard(product: CardProduct): { text: string; buttons: Button[] } {
  const lines = [product.title, product.description].filter((line) => line !== '');
  const inStock = product.variants.filter((v) => v.stock > v.reserved);
  if (inStock.length === 0) {
    return { text: [...lines, 'ተሸጦ አልቋል / Sold out.'].join('\n\n'), buttons: [] };
  }
  const priceLine =
    product.pricingMode === 'fixed'
      ? `ዋጋ / Price: ${formatBirr(product.price)}`
      : '💬 ዋጋ ይጠይቁኝ / Ask me the price, or make an offer.';
  return {
    text: [...lines, priceLine, 'መጠን ይምረጡ / Choose your size:'].join('\n\n'),
    buttons: inStock.map((v) => ({
      text: v.color ? `${v.size} ${v.color}` : v.size,
      data: `size:${v.id}`,
    })),
  };
}

/** The text of a product that photo search compares photos with. */
export function embeddingText(product: { title: string; description: string }): string {
  return [product.title, product.description].filter((part) => part !== '').join('\n');
}

/** A photo's description as text in the same form, for the search and for unmet demand. */
export function photoQueryText(photo: ProductPhoto): string {
  return [photo.category, photo.colors.join(', '), photo.brand, photo.style]
    .filter((part) => part !== null && part !== '')
    .join('; ');
}
