import { z } from 'zod';

const INVITE_PREFIX = 'drv_';

/**
 * The `/start` payload of an invite link. Telegram allows 64 characters of A-Z, a-z, 0-9, _
 * and -.
 */
export function inviteStartPayload(token: string): string {
  return `${INVITE_PREFIX}${token}`;
}

/** Parses a `/start` payload into an invite token: 24 random bytes in base64url. */
export const inviteTokenSchema = z
  .string()
  .regex(/^drv_[A-Za-z0-9_-]{32}$/)
  .transform((payload) => payload.slice(INVITE_PREFIX.length));

/** Splits callback data of the form `prefix:action:id`. */
const parts = (data: string) => {
  const [prefix, action, id] = data.split(':');
  return { prefix, action, id };
};

const jobActions = ['accept', 'picked', 'delivered', 'bonus'] as const;
export type JobAction = (typeof jobActions)[number];

/**
 * Telegram limits callback data to 64 bytes, so a job button carries one ID: the offer for
 * **Accept** and **Add bonus**, the job for **Picked up**, and the stop for **Delivered**.
 */
export function jobCallbackData(action: JobAction, id: string): string {
  return `job:${action}:${id}`;
}

export const jobCallbackSchema = z
  .string()
  .transform(parts)
  .pipe(z.object({ prefix: z.literal('job'), action: z.enum(jobActions), id: z.uuid() }));

const receiptAnswers = ['received', 'problem'] as const;
export type ReceiptAnswer = (typeof receiptAnswers)[number];

/** The customer's answer after a delivery. It carries the order ID. */
export function receiptCallbackData(answer: ReceiptAnswer, orderId: string): string {
  return `receipt:${answer}:${orderId}`;
}

export const receiptCallbackSchema = z
  .string()
  .transform(parts)
  .pipe(z.object({ prefix: z.literal('receipt'), action: z.enum(receiptAnswers), id: z.uuid() }));

const dutyStates = ['on', 'off'] as const;
export type DutyState = (typeof dutyStates)[number];

export function dutyCallbackData(state: DutyState): string {
  return `duty:${state}`;
}

export const dutyCallbackSchema = z
  .string()
  .transform((data) => data.split(':'))
  .pipe(z.tuple([z.literal('duty'), z.enum(dutyStates)]))
  .transform(([, state]) => state);
