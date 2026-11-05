export const orderTimerKinds = {
  paymentReminder: 'order.payment_reminder',
  expire: 'order.expire',
} as const;

type OrderTimerKind = (typeof orderTimerKinds)[keyof typeof orderTimerKinds];

const PAYMENT_REMINDER_DELAY_MS = 60 * 60_000;

/**
 * The timers that guard an unpaid order: a reminder one hour after it was placed, and its expiry
 * at the deadline. A deadline shorter than an hour leaves no time for a useful reminder.
 */
export function paymentTimers(
  createdAt: Date,
  deadline: Date,
): { kind: OrderTimerKind; dueAt: Date }[] {
  const expiry = { kind: orderTimerKinds.expire, dueAt: deadline };
  const remindAt = new Date(createdAt.getTime() + PAYMENT_REMINDER_DELAY_MS);
  return remindAt < deadline
    ? [{ kind: orderTimerKinds.paymentReminder, dueAt: remindAt }, expiry]
    : [expiry];
}

/** Whole minutes left before the deadline, never negative, so a late tick still reads sensibly. */
export function minutesLeft(deadline: Date, now: Date): number {
  return Math.max(0, Math.floor((deadline.getTime() - now.getTime()) / 60_000));
}
