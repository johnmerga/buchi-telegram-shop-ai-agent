import { z } from 'zod';

export const paymentProviderSchema = z.enum(['telebirr', 'cbe_birr', 'cbe_bank']);
export type PaymentProvider = z.infer<typeof paymentProviderSchema>;

export const createShopSchema = z.object({ name: z.string().trim().min(2).max(80) });
export type CreateShopInput = z.infer<typeof createShopSchema>;

export const shopLocationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});
export type ShopLocation = z.infer<typeof shopLocationSchema>;

export const paymentAccountSchema = z.object({
  provider: paymentProviderSchema,
  accountName: z.string().trim().min(2).max(80),
  accountNumber: z
    .string()
    .trim()
    .regex(/^[0-9]{6,20}$/, 'Use digits only.'),
});
export type PaymentAccount = z.infer<typeof paymentAccountSchema>;

export const paymentAccountsSchema = z.array(paymentAccountSchema).min(1).max(5);

/** A public channel username such as "@selamshoes", or a numeric chat ID such as "-1001234567890". */
export const connectChannelSchema = z.object({
  channel: z
    .string()
    .trim()
    .regex(/^(@[A-Za-z0-9_]{5,32}|-100[0-9]{5,15})$/, 'Use @channelname or the numeric chat ID.'),
});
export type ConnectChannelInput = z.infer<typeof connectChannelSchema>;
