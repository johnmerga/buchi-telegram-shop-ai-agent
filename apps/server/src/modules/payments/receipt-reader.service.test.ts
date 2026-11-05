import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../shared/errors';
import { ScriptedModel, type ScriptedTurn } from '../../../test/fakes/scripted-model';
import { ReceiptReader } from './receipt-reader.service';

const image = { mimeType: 'image/jpeg', data: 'aW1hZ2U=' };
const sure = <T>(value: T) => ({ value, confidence: 0.9 });
const extraction = {
  provider: sure('telebirr'),
  transactionRef: sure('DG92OT8YDE'),
  amount: sure('4500'),
  receiverName: sure('Selam Tesfaye'),
  receiverAccount: sure(null),
  payerName: sure(null),
  payerAccount: sure(null),
  paidAt: sure('2026-11-05T15:10:00'),
};

function readerWith(...turns: ScriptedTurn[]) {
  const model = new ScriptedModel(turns);
  return { model, reader: new ReceiptReader(model, pino({ level: 'silent' })) };
}

describe('ReceiptReader', () => {
  it('classifies an image with the fast model and a JSON schema', async () => {
    const { model, reader } = readerWith({ text: '{"kind":"receipt","confidence":0.92}' });
    expect(await reader.classify(image)).toEqual({ kind: 'receipt', confidence: 0.92 });
    expect(model.requests[0]).toMatchObject({
      tier: 'fast',
      contents: [{ role: 'user', parts: [{ inlineData: image }] }],
      responseJsonSchema: { type: 'object' },
    });
  });

  it('extracts the receipt with the smart model at payment priority', async () => {
    const { model, reader } = readerWith({ text: JSON.stringify(extraction) });
    expect(await reader.extract(image)).toEqual(extraction);
    expect(model.requests[0]).toMatchObject({ tier: 'smart', priority: 'payment' });
  });

  it('returns nothing for output that is not JSON or does not match the schema', async () => {
    const { reader } = readerWith(
      { text: 'The amount is 4500 birr.' },
      { text: JSON.stringify({ ...extraction, amount: sure('4,500 ETB') }) },
    );
    expect(await reader.extract(image)).toBeUndefined();
    expect(await reader.extract(image)).toBeUndefined();
  });

  it('returns nothing when the quota is spent or the model fails', async () => {
    const { reader } = readerWith(
      { error: new AppError('QUOTA_EXHAUSTED', 'No Gemini quota left') },
      { error: new Error('network down') },
    );
    expect(await reader.extract(image)).toBeUndefined();
    expect(await reader.classify(image)).toBeUndefined();
  });
});
