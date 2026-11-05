import type { Logger } from 'pino';
import type { z } from 'zod';
import type { LanguageModel, ModelTier, Priority } from '../../ai/language-model';
import type { Prompt } from '../../ai/prompts/prompt';
import { imageClassificationPrompt, receiptExtractionPrompt } from '../../ai/prompts/receipts';
import { failureOf, jsonSchemaOf, parseJson } from '../../ai/structured-output';
import {
  imageClassificationSchema,
  receiptExtractionSchema,
  type ImageClassification,
  type ReceiptExtraction,
} from './payments.schemas';

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
}

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
        contents: [{ role: 'user', parts: [{ inlineData: image }] }],
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
