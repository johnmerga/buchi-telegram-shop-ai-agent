import { describe, expect, it, vi } from 'vitest';
import { BankReceipts } from './bank-receipts';

describe('BankReceipts', () => {
  it("reads the provider's own receipt page with the shop's account number", async () => {
    const receipt = {
      txRef: 'CHK1234567',
      amount: '1500',
      receiver: { name: 'SELAM TESFAYE', account: '2519****4567' },
      completed: true,
      paidAt: null,
    };
    const read = vi.fn(() => Promise.resolve(receipt));
    const bank = new BankReceipts({ telebirr: { read } });
    expect(await bank.read('telebirr', 'CHK1234567', '0911234567')).toEqual(receipt);
    expect(read).toHaveBeenCalledWith('CHK1234567', '0911234567');
  });

  it('counts a provider without a receipt page as unavailable', async () => {
    expect(await new BankReceipts({}).read('cbe_birr', 'CHK1234567', null)).toBe('UNAVAILABLE');
  });
});
