import { z } from 'zod';
import { pricingModeSchema } from './enums';
import { Money, moneySchema } from './money';

const productFields = {
  title: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000).default(''),
};

/**
 * A fixed-price product shows its price. A negotiable product hides it: the owner sets a private
 * asking price and a lowest price, and the sales agent negotiates between them.
 */
export const productInputSchema = z.discriminatedUnion('pricingMode', [
  z.object({ ...productFields, pricingMode: z.literal('fixed'), price: moneySchema }),
  z
    .object({
      ...productFields,
      pricingMode: z.literal('negotiable'),
      price: moneySchema,
      lowestPrice: moneySchema,
    })
    .refine((p) => Money.of(p.lowestPrice).compare(Money.of(p.price)) <= 0, {
      message: 'The lowest price cannot be above the asking price.',
      path: ['lowestPrice'],
    }),
]);
export type ProductInput = z.infer<typeof productInputSchema>;

export const variantInputSchema = z.object({
  size: z.string().trim().min(1).max(20),
  color: z.string().trim().min(1).max(30).nullable().default(null),
  stock: z.number().int().min(0).max(100_000),
});
export type VariantInput = z.infer<typeof variantInputSchema>;

export const variantsInputSchema = z.array(variantInputSchema).min(1).max(50);

/** A product as the owner's editor sees it, with its private lowest price. */
export const productSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  description: z.string(),
  pricingMode: pricingModeSchema,
  price: moneySchema,
  lowestPrice: moneySchema.nullable(),
  photoFileIds: z.array(z.string()),
  active: z.boolean(),
  createdAt: z.iso.datetime(),
});

export const variantSchema = z.object({
  id: z.uuid(),
  size: z.string(),
  color: z.string().nullable(),
  stock: z.number().int(),
  /** Units held by open orders. Stock cannot go below it. */
  reserved: z.number().int(),
});

export const productWithVariantsSchema = productSchema.extend({ variants: z.array(variantSchema) });
export type ProductWithVariants = z.infer<typeof productWithVariantsSchema>;

/** Telegram accepts photos up to 10 MB in these formats. */
export const productPhotoTypes = ['image/jpeg', 'image/png', 'image/webp'];
export const MAX_PRODUCT_PHOTO_BYTES = 10 * 1024 * 1024;

export const channelPostSchema = z.object({ postId: z.uuid() });
