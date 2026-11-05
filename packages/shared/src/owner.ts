import { z } from 'zod';
import { agentNames } from './enums';

/** One message of a customer's chat, as the sales agent remembers it. */
const conversationTurnSchema = z.object({
  role: z.enum(['customer', 'buchi']),
  text: z.string(),
  at: z.iso.datetime(),
});

/** A customer chat on the owner's **Conversations** screen. `human` means an owner is answering. */
export const conversationItemSchema = z.object({
  id: z.uuid(),
  customerName: z.string(),
  mode: z.enum(['agent', 'human']),
  handBackAt: z.iso.datetime().nullable(),
  updatedAt: z.iso.datetime(),
  lastTurns: z.array(conversationTurnSchema),
});
export type ConversationItem = z.infer<typeof conversationItemSchema>;

/**
 * A policy guard decision with its reason and evidence. `ownerCanDecide` marks a pending request
 * that the dashboard can approve; other pending ones are answered in the Telegram chat.
 */
export const aiDecisionSchema = z.object({
  id: z.uuid(),
  agent: z.enum(agentNames),
  tool: z.string(),
  result: z.enum(['accepted', 'rejected', 'needs_owner']),
  reason: z.string(),
  agentReason: z.string().nullable(),
  proposed: z.record(z.string(), z.unknown()),
  limits: z.record(z.string(), z.union([z.string(), z.number(), z.null()])).nullable(),
  counteroffer: z.union([z.string(), z.number()]).nullable(),
  evidenceIds: z.array(z.string()),
  ownerStatus: z.enum(['pending', 'approved', 'declined']).nullable(),
  ownerCanDecide: z.boolean(),
  createdAt: z.iso.datetime(),
  decidedAt: z.iso.datetime().nullable(),
});
export type AiDecision = z.infer<typeof aiDecisionSchema>;

export const approvalChoiceSchema = z.enum(['approve', 'decline']);
export type ApprovalChoice = z.infer<typeof approvalChoiceSchema>;

/** `error` explains an approved action that could not run, such as a job a driver already took. */
export const approvalOutcomeSchema = z.object({
  status: z.enum(['approved', 'declined', 'already_decided']),
  error: z.string().nullable(),
});
export type ApprovalOutcome = z.infer<typeof approvalOutcomeSchema>;
