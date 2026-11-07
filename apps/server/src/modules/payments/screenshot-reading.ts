import type { ReceiptExtraction } from './payments.schemas';
import type { Image, ReceiptReader } from './receipt-reader.service';
import { interpretReceipt, withReference, type Reading } from './receipt-reading.domain';

/** A screenshot as code read it, with the model's copy of its text. */
export interface ScreenshotReading {
  extraction: ReceiptExtraction;
  reading: Reading;
}

/**
 * The model copies the receipt and code reads it. When only the transaction reference failed,
 * the model copies that one value once more, and code keeps the new copy only if it then reads.
 * Returns `undefined` when the model could not copy the receipt at all.
 */
export async function readScreenshot(
  reader: Pick<ReceiptReader, 'extract' | 'readReference'>,
  image: Image,
  classificationConfidence: number | null,
): Promise<ScreenshotReading | undefined> {
  const extraction = await reader.extract(image);
  if (!extraction) return undefined;
  const reading = interpretReceipt(extraction, classificationConfidence);
  if (reading.status !== 'bad_reference') return { extraction, reading };

  const reference = await reader.readReference(image, reading.provider);
  if (reference === undefined) return { extraction, reading };
  const corrected = withReference(extraction, reference);
  const again = interpretReceipt(corrected, classificationConfidence);
  return again.status === 'read'
    ? { extraction: corrected, reading: again }
    : { extraction, reading };
}
