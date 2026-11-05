import { formatBirr, type MoneyString, type PricingMode } from '@buchi/shared';

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
