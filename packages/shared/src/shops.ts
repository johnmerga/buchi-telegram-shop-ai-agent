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

/** The wallets take an Ethiopian mobile number, with or without the country code. */
const walletNumber = /^(?:0|251)[79][0-9]{8}$/;

/** What each provider's account number looks like, so a CBE account is not saved as CBE Birr. */
const accountNumberFormats: Record<PaymentProvider, { pattern: RegExp; message: string }> = {
  telebirr: {
    pattern: walletNumber,
    message: 'Use the Telebirr phone number, such as 0911234567.',
  },
  cbe_birr: {
    pattern: walletNumber,
    message:
      'Use the CBE Birr phone number, such as 0911234567. A 13-digit number is a CBE bank account.',
  },
  cbe_bank: {
    pattern: /^[0-9]{13}$/,
    message:
      'A CBE bank account number has 13 digits, such as 1000123456789. A phone number is CBE Birr.',
  },
};

/** An account as the owner enters it: its number must fit the provider. */
export const paymentAccountInputSchema = paymentAccountSchema.superRefine((account, ctx) => {
  const format = accountNumberFormats[account.provider];
  if (!format.pattern.test(account.accountNumber)) {
    ctx.addIssue({ code: 'custom', path: ['accountNumber'], message: format.message });
  }
});

export const paymentAccountsSchema = z.array(paymentAccountInputSchema).min(1).max(5);

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
