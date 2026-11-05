export type DeadlineExtensionDecision =
  | { result: 'accepted'; reason: 'within_limits'; value: number }
  | { result: 'needs_owner'; reason: 'already_extended' | 'too_long' };

/** The design doc's limit: one extension of up to two hours runs without the owner. */
export const MAX_AUTOMATIC_MINUTES = 120;

/** An agent may extend a payment deadline once per order, by up to two hours. */
export function checkDeadlineExtension(
  minutes: number,
  extensionsMade: number,
): DeadlineExtensionDecision {
  if (!Number.isInteger(minutes) || minutes < 1) {
    throw new RangeError('An extension is a positive whole number of minutes');
  }
  if (extensionsMade > 0) return { result: 'needs_owner', reason: 'already_extended' };
  if (minutes > MAX_AUTOMATIC_MINUTES) return { result: 'needs_owner', reason: 'too_long' };
  return { result: 'accepted', reason: 'within_limits', value: minutes };
}
