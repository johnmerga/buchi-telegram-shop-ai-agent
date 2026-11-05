import { z } from 'zod';
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
