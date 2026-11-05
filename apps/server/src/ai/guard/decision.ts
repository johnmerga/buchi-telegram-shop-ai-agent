import type { ToolResult } from '../tool';

/**
 * What a checker decided about a value an agent proposed. Limits are inputs to a checker and never
 * part of its decision, so nothing that derives from a decision can carry the lowest price.
 */
export type Decision<Value> =
  | { result: 'accepted'; reason: string; value: Value }
  | { result: 'rejected'; reason: string; counteroffer: Value }
  | { result: 'needs_owner'; reason: string };

/** The part of a decision the model may read: no limits, and no reason for an accepted value. */
export function toToolResult<Value>(
  decision: Decision<Value>,
  serialize: (value: Value) => string | number,
): ToolResult {
  switch (decision.result) {
    case 'accepted':
      return { status: 'ok', output: { accepted: serialize(decision.value) } };
    case 'rejected':
      return {
        status: 'rejected',
        reason: decision.reason,
        counteroffer: serialize(decision.counteroffer),
      };
    case 'needs_owner':
      return { status: 'awaiting_owner' };
  }
}
