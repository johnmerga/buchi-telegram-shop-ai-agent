import { agentNames } from '@buchi/shared';
import { sql } from 'drizzle-orm';
import { check, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { shopIsolation } from './rls';
import { shops } from './shops';

export const agentName = pgEnum('agent_name', agentNames);

export const agentDecisionResult = pgEnum('agent_decision_result', [
  'accepted',
  'rejected',
  'needs_owner',
]);

/** A decision that needs the owner waits as `pending` until the owner taps a button. */
export const ownerConfirmationStatus = pgEnum('owner_confirmation_status', [
  'pending',
  'approved',
  'declined',
]);

export const modelTier = pgEnum('model_tier', ['fast', 'smart']);

/** What one model call led to: a reply, more tool calls, an escalation, or a failed call. */
export const agentTraceOutcome = pgEnum('agent_trace_outcome', [
  'reply',
  'tool_calls',
  'escalated',
  'failed',
]);

type JsonScalar = string | number | null;

const shopId = () =>
  uuid('shop_id')
    .notNull()
    .references(() => shops.id, { onDelete: 'cascade' });

/**
 * Every value an agent proposed, the private limits it was checked against, and the result.
 * Only the owner's views read this table, so the limits here never reach the model.
 */
export const agentDecisions = pgTable(
  'agent_decisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: shopId(),
    runId: uuid('run_id').notNull(),
    agent: agentName('agent').notNull(),
    tool: text('tool').notNull(),
    proposed: jsonb('proposed').$type<Record<string, unknown>>().notNull(),
    limits: jsonb('limits').$type<Record<string, JsonScalar>>(),
    result: agentDecisionResult('result').notNull(),
    reason: text('reason').notNull(),
    /** Wrapped as `{ value }` like `proposed`: Drizzle parses a bare JSON string twice on read. */
    counteroffer: jsonb('counteroffer').$type<{ value: string | number }>(),
    agentReason: text('agent_reason'),
    evidenceIds: text('evidence_ids')
      .array()
      .notNull()
      .default(sql`'{}'`),
    ownerStatus: ownerConfirmationStatus('owner_status'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'agent_decisions_owner_status_iff_needs_owner',
      sql`(${t.result} = 'needs_owner') = (${t.ownerStatus} is not null)`,
    ),
    check(
      'agent_decisions_counteroffer_iff_rejected',
      sql`(${t.result} = 'rejected') = (${t.counteroffer} is not null)`,
    ),
    shopIsolation(t.shopId),
  ],
);

interface TracedToolCall {
  name: string;
  args: Record<string, unknown>;
  status: string;
}

/** One row per model call, so quota use, latency, and tool behavior can be explained later. */
export const agentTraces = pgTable(
  'agent_traces',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: shopId(),
    runId: uuid('run_id').notNull(),
    step: integer('step').notNull(),
    agent: agentName('agent').notNull(),
    promptId: text('prompt_id').notNull(),
    promptVersion: integer('prompt_version').notNull(),
    modelTier: modelTier('model_tier').notNull(),
    toolCalls: jsonb('tool_calls').$type<TracedToolCall[]>().notNull(),
    inputTokens: integer('input_tokens').notNull(),
    outputTokens: integer('output_tokens').notNull(),
    latencyMs: integer('latency_ms').notNull(),
    outcome: agentTraceOutcome('outcome').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [shopIsolation(t.shopId)],
);
