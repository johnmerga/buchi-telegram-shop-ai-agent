import { describe, expect, it, vi } from 'vitest';
import { BankReceipts } from './bank-receipts';
import type { ReceiptClaim } from './receipt-check';

const claim: ReceiptClaim = {
  txRef: 'CHK1234567',
  amount: '1500.00',
  account: { accountName: 'Selam Tesfaye', accountNumber: '0911234567' },
};

describe('BankReceipts', () => {
  it("asks the provider's own receipt page", async () => {
    const check = vi.fn(() => Promise.resolve('CONFIRMED' as const));
    expect(await new BankReceipts({ telebirr: { check } }).check('telebirr', claim)).toBe(
      'CONFIRMED',
    );
    expect(check).toHaveBeenCalledWith(claim);
  });

  it('counts a provider without a receipt page as unavailable', async () => {
    expect(await new BankReceipts({}).check('cbe_birr', claim)).toBe('UNAVAILABLE');
  });
});
