import type { Logger } from 'pino';
import type { z } from 'zod';
import type { LanguageModel, ModelTier, Priority } from '../../ai/language-model';
import type { Prompt } from '../../ai/prompts/prompt';
import {
  imageClassificationPrompt,
  receiptExtractionPrompt,
  receiptReferencePrompt,
} from '../../ai/prompts/receipts';
import { failureOf, jsonSchemaOf, parseJson } from '../../ai/structured-output';
import {
  imageClassificationSchema,
  receiptExtractionSchema,
  receiptReferenceSchema,
  type ImageClassification,
  type ReceiptExtraction,
} from './payments.schemas';
import type { ReceiptProvider } from './receipt-layouts.domain';

/** An image from a customer, as Gemini receives it inline. */
export interface Image {
  mimeType: string;
  /** Base64-encoded bytes. */
  data: string;
}

interface Reading<T extends z.ZodType> {
  prompt: Prompt;
  tier: ModelTier;
  priority: Priority;
  schema: T;
  /** What to log on failure. Never the receipt itself. */
  step: string;
  /** Text that goes with the image, such as the shape a value must have. */
  note?: string;
}

/** The shape of each provider's references, which the second look checks its copy against. */
const referenceShapes: Record<ReceiptProvider, string> = {
  cbe_bank:
    'This is a Commercial Bank of Ethiopia receipt. Its reference has 12 characters: "FT", two digits of the year, three digits of the day of the year, and five capital letters or digits, such as FT26311900GR.',
  telebirr:
    'This is a Telebirr receipt. Its transaction number has 10 capital letters or digits, such as DK73SSK4JJ.',
};

/**
 * Reads customer images with Gemini. A failed or malformed answer returns `undefined`, so the
 * caller falls back to owner review instead of trusting it.
 */
export class ReceiptReader {
  constructor(
    private readonly model: LanguageModel,
    private readonly logger: Logger,
  ) {}

  classify(image: Image): Promise<ImageClassification | undefined> {
    return this.read(image, {
      prompt: imageClassificationPrompt,
      tier: 'fast',
      // Only a receipt is a payment check, and the caller treats an unclassified image as one.
      priority: 'customer',
      schema: imageClassificationSchema,
      step: 'classify',
    });
  }

  extract(image: Image): Promise<ReceiptExtraction | undefined> {
    return this.read(image, {
      prompt: receiptExtractionPrompt,
      tier: 'smart',
      priority: 'payment',
      schema: receiptExtractionSchema,
      step: 'extract',
    });
  }

  /** Copies only the transaction reference again, after the first copy did not fit its shape. */
  async readReference(image: Image, provider: ReceiptProvider): Promise<string | undefined> {
    const read = await this.read(image, {
      prompt: receiptReferencePrompt,
      tier: 'smart',
      priority: 'payment',
      schema: receiptReferenceSchema,
      step: 'reference',
      note: referenceShapes[provider],
    });
    return read?.transactionRef.value ?? undefined;
  }

  private async read<T extends z.ZodType>(
    image: Image,
    reading: Reading<T>,
  ): Promise<z.output<T> | undefined> {
    let text: string | undefined;
    try {
      const result = await this.model.generate({
        tier: reading.tier,
        priority: reading.priority,
        systemInstruction: reading.prompt.text,
        contents: [
          {
            role: 'user',
            parts: [{ inlineData: image }, ...(reading.note ? [{ text: reading.note }] : [])],
          },
        ],
        responseJsonSchema: jsonSchemaOf(reading.schema),
      });
      text = result.text;
    } catch (err) {
      this.logger.warn({ step: reading.step, failure: failureOf(err) }, 'image reading failed');
      return undefined;
    }
    const parsed = reading.schema.safeParse(parseJson(text));
    if (parsed.success) return parsed.data;
    this.logger.warn({ step: reading.step, failure: 'invalid_output' }, 'image reading failed');
    return undefined;
  }
}
