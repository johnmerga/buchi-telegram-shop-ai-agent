import { z } from 'zod';

/** What the fast model sees in a customer's product photo. Model output is untrusted. */
export const productPhotoSchema = z.object({
  category: z.string().trim().min(1).max(60),
  colors: z.array(z.string().trim().min(1).max(30)).max(4),
  brand: z.string().trim().min(1).max(60).nullable(),
  style: z.string().trim().max(120),
});
export type ProductPhoto = z.infer<typeof productPhotoSchema>;
