import { describe, expect, it } from 'vitest';
import { paymentAccountInputSchema } from './shops';

const account = (provider: 'telebirr' | 'cbe_birr' | 'cbe_bank', accountNumber: string) => ({
  provider,
  accountName: 'Yohannes Merga',
  accountNumber,
});

describe('paymentAccountInputSchema', () => {
  it('takes a phone number for the wallets and 13 digits for a CBE account', () => {
    expect(paymentAccountInputSchema.safeParse(account('telebirr', '0911234567')).success).toBe(
      true,
    );
    expect(paymentAccountInputSchema.safeParse(account('cbe_birr', '251711234567')).success).toBe(
      true,
    );
    expect(paymentAccountInputSchema.safeParse(account('cbe_bank', '1000123456789')).success).toBe(
      true,
    );
  });

  it('refuses a CBE bank account saved as CBE Birr, and a phone saved as a CBE account', () => {
    const wallet = paymentAccountInputSchema.safeParse(account('cbe_birr', '1000123456789'));
    expect(wallet.error?.issues[0]?.path).toEqual(['accountNumber']);
    expect(wallet.error?.issues[0]?.message).toContain('CBE bank account');
    expect(paymentAccountInputSchema.safeParse(account('cbe_bank', '0911234567')).success).toBe(
      false,
    );
  });
});
