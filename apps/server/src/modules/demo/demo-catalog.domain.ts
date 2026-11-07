import { Money, type ProductInput, type VariantInput } from '@buchi/shared';
import { z } from 'zod';

/**
 * One demo product as the photo list names it: a photo file, its brand, and for football boots
 * the seller's item code. Nothing else from the seller's posts is used.
 */
export const demoPhotoSchema = z.object({
  photo: z.string().min(1),
  brand: z.string().trim().min(1),
  itemCode: z.string().trim().min(1).optional(),
  color: z.string().trim().min(1).optional(),
});
export type DemoPhoto = z.infer<typeof demoPhotoSchema>;

export interface DemoProduct {
  photo: string;
  product: ProductInput;
  variants: VariantInput[];
}

const FOOTBALL_SIZES = ['39', '40', '41', '42', '43', '44', '45'];
const KIDS_SIZES = ['28', '29', '30', '31', '32', '33', '34', '35'];
/** Asking prices step in fifties, as Addis shops quote them. */
const PRICE_STEP = Money.of('50');

/**
 * The demo catalog: football boots by item code, kids' shoes by brand and colour. Prices, the
 * negotiable range, and stock come from the generator, so every run gives the same catalog.
 */
export function demoProducts(photos: DemoPhoto[], random: () => number): DemoProduct[] {
  return photos.map((photo) => {
    const football = photo.itemCode !== undefined;
    const asking = priceBetween(random, football ? 2800 : 1900, football ? 3600 : 2900);
    const negotiable = football || random() < 0.5;
    const product: ProductInput = negotiable
      ? {
          title: demoTitle(photo),
          description: descriptionOf(photo),
          pricingMode: 'negotiable',
          price: asking.toString(),
          lowestPrice: asking.times(85).divideRoundingUp(100).roundUpTo(PRICE_STEP).toString(),
        }
      : {
          title: demoTitle(photo),
          description: descriptionOf(photo),
          pricingMode: 'fixed',
          price: asking.toString(),
        };
    const sizes = football ? FOOTBALL_SIZES : KIDS_SIZES;
    const variants = sizes.map((size) => ({
      size,
      color: null,
      stock: 1 + Math.floor(random() * 4),
    }));
    return { photo: photo.photo, product, variants };
  });
}

/** The title of a demo product, which the photo upload finds it by. */
export function demoTitle(photo: DemoPhoto): string {
  if (photo.itemCode !== undefined) return `${photo.brand} · ${photo.itemCode}`;
  return photo.color === undefined ? `${photo.brand} kids` : `${photo.brand} kids · ${photo.color}`;
}

function descriptionOf(photo: DemoPhoto): string {
  return photo.itemCode !== undefined
    ? 'ቶርሽን / Football boots for grass and turf'
    : 'የልጆች ጫማ / Kids sneakers, sizes 28–35';
}

function priceBetween(random: () => number, low: number, high: number): Money {
  const birr = low + random() * (high - low);
  return Money.of(String(Math.round(birr))).roundUpTo(PRICE_STEP);
}
