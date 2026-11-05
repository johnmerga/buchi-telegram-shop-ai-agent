import { z } from 'zod';
import { coordinatesSchema } from './geo';

export const paymentProviders = ['telebirr', 'cbe_birr', 'cbe_bank'] as const;
export const paymentProviderSchema = z.enum(paymentProviders);
export type PaymentProvider = z.infer<typeof paymentProviderSchema>;

export const createShopSchema = z.object({ name: z.string().trim().min(2).max(80) });
export type CreateShopInput = z.infer<typeof createShopSchema>;

export const shopLocationSchema = coordinatesSchema;
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

/** A shop as the owner API returns it. */
export const shopSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  channelChatId: z.number().int().nullable(),
  channelTitle: z.string().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  createdAt: z.iso.datetime(),
});
export type Shop = z.infer<typeof shopSchema>;

export const shopDetailsSchema = shopSchema.extend({
  paymentAccounts: z.array(paymentAccountSchema),
});

export const createdShopSchema = z.object({ id: z.uuid() });
export const connectedChannelSchema = z.object({ title: z.string() });
