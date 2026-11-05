import {
  formatBirr,
  productInputSchema,
  type MoneyString,
  type PricingMode,
  type ProductInput,
  type VariantInput,
} from '@buchi/shared';
import type { Button } from '../owner/owner.domain';
import { listingCallbackData, type ListingDraft } from './listings.schemas';

/** A draft as the owner sees it: the model's words, and the prices only the owner wrote. */
export interface DraftView {
  id: string;
  draft: ListingDraft;
  pricingMode: PricingMode;
  price: MoneyString | null;
  lowestPrice: MoneyString | null;
  stockPerSize: number;
}

export function isPriced(view: DraftView): boolean {
  return view.price !== null && (view.pricingMode === 'fixed' || view.lowestPrice !== null);
}

function priceLine(view: DraftView): string {
  const { price, lowestPrice } = view;
  if (view.pricingMode === 'fixed') {
    return price === null
      ? '⚠️ No price yet. Reply to this message with the price, such as "3500".'
      : `Price: ${formatBirr(price)} (from your note)`;
  }
  return price === null || lowestPrice === null
    ? '💬 Negotiable: reply to this message with the asking and the lowest price, such as "3500 3000". Customers never see them.'
    : `Negotiable: asking ${formatBirr(price)}, lowest ${formatBirr(lowestPrice)} (private)`;
}

/** The draft message, with **Post** once the owner has given every price. */
export function draftPreview(view: DraftView): { text: string; buttons: Button[] } {
  const { draft } = view;
  const colors = draft.colors.length > 0 ? ` · Colors: ${draft.colors.join(', ')}` : '';
  const text = [
    '📝 ረቂቅ / Draft listing',
    titleOf(draft),
    draft.description.en,
    `Category: ${draft.category}${colors}`,
    `Sizes: ${draft.sizes.join(', ')} · ${String(view.stockPerSize)} of each`,
    priceLine(view),
    'To change it, reply to this message with a new note.',
  ].join('\n');
  const post = isPriced(view)
    ? [{ text: '📤 ለጥፍ / Post', data: listingCallbackData('post', view.id) }]
    : [];
  return {
    text,
    buttons: [
      ...post,
      { text: '✏️ አስተካክል / Edit', data: listingCallbackData('edit', view.id) },
      { text: '🗑 ሰርዝ / Discard', data: listingCallbackData('discard', view.id) },
    ],
  };
}

function titleOf(draft: ListingDraft): string {
  return draft.title.en === draft.title.am
    ? draft.title.en
    : `${draft.title.en} · ${draft.title.am}`;
}

/**
 * The product and its sizes from a priced draft. One color names every size; several colors stay
 * in the description, because the note does not say which sizes come in which color.
 */
export function listingOf(view: DraftView): { product: ProductInput; variants: VariantInput[] } {
  const { draft } = view;
  const product = productInputSchema.parse({
    title: titleOf(draft),
    description: [draft.description.en, draft.description.am].join('\n\n'),
    pricingMode: view.pricingMode,
    price: view.price,
    ...(view.pricingMode === 'negotiable' ? { lowestPrice: view.lowestPrice } : {}),
  });
  const color = draft.colors.length === 1 ? (draft.colors[0] ?? null) : null;
  const variants = [...new Set(draft.sizes)].map((size) => ({
    size,
    color,
    stock: view.stockPerSize,
  }));
  return { product, variants };
}
