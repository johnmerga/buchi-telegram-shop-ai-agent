import { describe, expect, it, vi } from 'vitest';
import type { ReceiptExtraction } from './payments.schemas';
import { readScreenshot } from './screenshot-reading';

const sure = (value: string | null) => ({ value, confidence: 0.99 });

/** A CBE app summary screen whose reference the model copied with one zero too few. Made up. */
const dropped: ReceiptExtraction = {
  layout: { value: 'cbe_app_success', confidence: 0.99 },
  transactionRef: sure('FT2631190GR'),
  amount: sure('ETB 17.50'),
  serviceCharge: sure('ETB0.50'),
  vat: sure('ETB0.08'),
  otherCharge: sure('ETB0.03'),
  totalAmount: sure('ETB18.11'),
  paidAt: sure('Nov 07, 2026 12:10 PM'),
  receiverName: sure('Meron Alemu Kebede'),
  receiverAccount: sure('ETB-4321'),
  payerName: sure('Dawit Hailu'),
  payerAccount: sure('ETB-8765'),
  status: sure('Success'),
};

const image = { mimeType: 'image/jpeg', data: '' };

function reader(extraction: ReceiptExtraction | undefined, reference: string | undefined) {
  return {
    extract: vi.fn(() => Promise.resolve(extraction)),
    readReference: vi.fn(() => Promise.resolve(reference)),
  };
}

describe('readScreenshot', () => {
  it('reads the reference again, and keeps the new copy when it reads', async () => {
    const model = reader(dropped, 'FT26311900GR');
    const read = await readScreenshot(model, image, 0.9);
    expect(model.readReference).toHaveBeenCalledWith(image, 'cbe_bank');
    expect(read?.reading).toMatchObject({ status: 'read', receipt: { txRef: 'FT26311900GR' } });
    expect(read?.extraction.transactionRef.value).toBe('FT26311900GR');
  });

  it('keeps the first copy when the second does not read either', async () => {
    const read = await readScreenshot(reader(dropped, 'FT2631190GR'), image, 0.9);
    expect(read).toEqual({
      extraction: dropped,
      reading: { status: 'bad_reference', provider: 'cbe_bank', problem: 'unparseable' },
    });
  });

  it('never asks again for a receipt that read, or one with another problem', async () => {
    const good = reader({ ...dropped, transactionRef: sure('FT26311900GR') }, undefined);
    await readScreenshot(good, image, 0.9);
    const unclear = reader({ ...dropped, amount: { value: 'ETB 17.50', confidence: 0.3 } }, 'x');
    await readScreenshot(unclear, image, 0.9);
    expect(good.readReference).not.toHaveBeenCalled();
    expect(unclear.readReference).not.toHaveBeenCalled();
  });

  it('returns nothing when the model could not copy the receipt', async () => {
    expect(await readScreenshot(reader(undefined, undefined), image, 0.9)).toBeUndefined();
  });
});
