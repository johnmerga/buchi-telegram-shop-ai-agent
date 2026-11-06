import { describe, expect, it, vi } from 'vitest';
import { BankReceipts } from './bank-receipts';
import type { ReceiptClaim } from './receipt-check';

const claim: ReceiptClaim = {
  txRef: 'CHK1234567',
  amount: '1500.00',
  account: { accountName: 'Selam Tesfaye', accountNumber: '0911234567' },
};

describe('BankReceipts', () => {
  it("compares the claim with the provider's own receipt page", async () => {
    const read = vi.fn(() =>
      Promise.resolve({
        txRef: 'CHK1234567',
        amount: '1500',
        receiver: { name: 'SELAM TESFAYE', account: '2519****4567' },
        completed: true,
        paidAt: null,
      }),
    );
    const bank = new BankReceipts({ telebirr: { read } });
    expect(await bank.check('telebirr', claim)).toBe('CONFIRMED');
    expect(await bank.check('telebirr', { ...claim, amount: '1600.00' })).toBe('MISMATCH');
    expect(read).toHaveBeenCalledWith('CHK1234567', '0911234567');
  });

  it("passes on the page's own answer when there is no receipt", async () => {
    const bank = new BankReceipts({ telebirr: { read: () => Promise.resolve('NOT_FOUND') } });
    expect(await bank.check('telebirr', claim)).toBe('NOT_FOUND');
  });

  it('counts a provider without a receipt page as unavailable', async () => {
    expect(await new BankReceipts({}).check('cbe_birr', claim)).toBe('UNAVAILABLE');
    expect(await new BankReceipts({}).read('cbe_birr', 'CHK1234567', null)).toBe('UNAVAILABLE');
  });
});
