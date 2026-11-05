import { z } from 'zod';

const problemKinds = ['wrong_size', 'damaged', 'other'] as const;
export type ProblemKind = (typeof problemKinds)[number];

/** The customer's answer to "What is wrong?". It carries the order ID. */
export function problemCallbackData(kind: ProblemKind, orderId: string): string {
  return `problem:${kind}:${orderId}`;
}

export const problemCallbackSchema = z
  .string()
  .transform((data) => {
    const [prefix, kind, orderId] = data.split(':');
    return { prefix, kind, orderId };
  })
  .pipe(z.object({ prefix: z.literal('problem'), kind: z.enum(problemKinds), orderId: z.uuid() }));

const SIZE_PREFIX = 'xsize';
/** Telegram's limit for callback data. */
const MAX_CALLBACK_BYTES = 64;

/**
 * The size a customer wants instead, as `xsize:<orderId>:<size>`, or `undefined` when a long
 * size would not fit Telegram's 64 bytes.
 */
export function wantedSizeCallbackData(orderId: string, size: string): string | undefined {
  const data = `${SIZE_PREFIX}:${orderId}:${size}`;
  return Buffer.byteLength(data) <= MAX_CALLBACK_BYTES ? data : undefined;
}

export const wantedSizeCallbackSchema = z
  .string()
  .transform((data) => {
    const [prefix, orderId, ...size] = data.split(':');
    return { prefix, orderId, size: size.join(':') };
  })
  .pipe(
    z.object({
      prefix: z.literal(SIZE_PREFIX),
      orderId: z.uuid(),
      size: z.string().min(1),
    }),
  );
