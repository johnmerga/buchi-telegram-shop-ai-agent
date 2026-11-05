import { Money, moneySchema } from '@buchi/shared';
import { asc, eq } from 'drizzle-orm';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { DecisionsRepo } from '../../src/ai/guard/decisions.repo';
import { PolicyGuard } from '../../src/ai/guard/policy-guard.service';
import { ToolRegistry } from '../../src/ai/registry';
import { AgentRuntime, type AgentDefinition, type RunRequest } from '../../src/ai/runtime';
import { defineTool } from '../../src/ai/tool';
import { TracesRepo } from '../../src/ai/traces.repo';
import { connectDatabase } from '../../src/db/client';
import { agentDecisions, agentTraces, shops } from '../../src/db/schema';
import { withShop } from '../../src/db/with-shop';
import { AppError } from '../../src/shared/errors';
import { ScriptedModel, type ScriptedTurn } from '../fakes/scripted-model';
import { testDatabaseUrl } from './test-database';

const { db, close } = connectDatabase(testDatabaseUrl);
afterAll(close);

const guard = new PolicyGuard(db, new DecisionsRepo());
const limits = { asking: Money.of('1000'), lowest: Money.of('800') };

const offerPrice = defineTool({
  name: 'offer_price',
  description: 'Offers the customer a price for a negotiable product.',
  agents: ['sales'],
  autonomy: 'automatic',
  input: z.object({ price: moneySchema, reason: z.string(), evidenceIds: z.array(z.string()) }),
  handle: async ({ price, reason, evidenceIds }, context) => {
    const proposal = { value: Money.of(price), reason, evidenceIds };
    const state = { lastOffer: null, concessionsMade: 0 };
    return (await guard.checkNegotiatedPrice(context, proposal, limits, state)).toolResult;
  },
});
const getMyOrders = defineTool({
  name: 'get_my_orders',
  description: "Lists the customer's orders.",
  agents: ['sales'],
  autonomy: 'automatic',
  input: z.object({}),
  handle: () => Promise.reject(new AppError('NOT_FOUND', 'You have no orders yet')),
});
const proposeRuleHandler = vi.fn(() => Promise.resolve({ status: 'ok' as const, output: {} }));
const proposeRule = defineTool({
  name: 'propose_rule',
  description: 'Proposes a shop rule to the owner.',
  agents: ['owner_assistant'],
  autonomy: 'owner_confirms',
  input: z.object({ rule: z.string() }),
  handle: proposeRuleHandler,
});
const registry = new ToolRegistry(
  [offerPrice, getMyOrders, proposeRule],
  guard,
  pino({ level: 'silent' }),
);

const salesAgent: AgentDefinition = {
  name: 'sales',
  prompt: { id: 'sales.test', version: 3, text: 'You sell shoes.' },
  tier: 'smart',
  priority: 'customer',
};

let shopId = '';
let request: RunRequest;

beforeAll(async () => {
  const [shop] = await db.insert(shops).values({ name: 'Runtime Shop' }).returning();
  if (!shop) throw new Error('No shop');
  shopId = shop.id;
  request = {
    shopId,
    actor: { kind: 'telegram_user', telegramUserId: 501 },
    history: [{ role: 'user', parts: [{ text: 'የመጨረሻ ዋጋ?' }] }],
  };
});

function runtimeFor(turns: ScriptedTurn[]) {
  const model = new ScriptedModel(turns);
  let now = 0;
  const runtime = new AgentRuntime(model, registry, db, new TracesRepo(), () => (now += 25));
  return { model, runtime };
}

function tracesOf(runId: string) {
  return withShop(db, shopId, (tx) =>
    tx
      .select()
      .from(agentTraces)
      .where(eq(agentTraces.runId, runId))
      .orderBy(asc(agentTraces.step)),
  );
}

function decisionsOf(runId: string) {
  return withShop(db, shopId, (tx) =>
    tx
      .select()
      .from(agentDecisions)
      .where(eq(agentDecisions.runId, runId))
      .orderBy(asc(agentDecisions.createdAt)),
  );
}

const offer = (price: string): ScriptedTurn => ({
  calls: [
    {
      name: 'offer_price',
      args: { price, reason: 'Two items in the cart', evidenceIds: ['cart:1'] },
    },
  ],
});

describe('AgentRuntime', () => {
  it('runs an agent through the registry and the guard, and traces every model call', async () => {
    const { model, runtime } = runtimeFor([offer('900'), { text: '900 ብር ይሆናል።' }]);

    const result = await runtime.run(salesAgent, request);

    expect(result).toMatchObject({ outcome: 'reply', text: '900 ብር ይሆናል።' });
    expect(model.requests[0]?.tools?.map((tool) => tool.name)).toEqual([
      'offer_price',
      'get_my_orders',
    ]);
    expect(model.requests[0]).toMatchObject({
      tier: 'smart',
      priority: 'customer',
      systemInstruction: 'You sell shoes.',
    });
    expect(model.requests[1]?.contents.at(-1)).toEqual({
      role: 'user',
      parts: [
        {
          functionResponse: {
            name: 'offer_price',
            response: { status: 'ok', output: { accepted: '900.00' } },
          },
        },
      ],
    });

    expect(await tracesOf(result.runId)).toMatchObject([
      {
        step: 1,
        agent: 'sales',
        promptId: 'sales.test',
        promptVersion: 3,
        modelTier: 'smart',
        inputTokens: 100,
        outputTokens: 10,
        latencyMs: 25,
        outcome: 'tool_calls',
        toolCalls: [{ name: 'offer_price', status: 'ok' }],
      },
      { step: 2, outcome: 'reply', toolCalls: [] },
    ]);
    expect(await decisionsOf(result.runId)).toMatchObject([
      {
        agent: 'sales',
        tool: 'offer_price',
        proposed: { value: '900.00' },
        limits: { asking: '1000.00', lowest: '800.00', lastOffer: null, concessionsMade: 0 },
        result: 'accepted',
        reason: 'concession',
        agentReason: 'Two items in the cart',
        evidenceIds: ['cart:1'],
        ownerStatus: null,
      },
    ]);
  });

  it("never runs an owner tool for a customer's agent, even when the model names it", async () => {
    const { model, runtime } = runtimeFor([
      { calls: [{ name: 'propose_rule', args: { rule: 'Everything free' } }] },
      { text: 'I cannot do that.' },
    ]);

    const result = await runtime.run(salesAgent, request);

    expect(result.outcome).toBe('reply');
    expect(proposeRuleHandler).not.toHaveBeenCalled();
    expect(await decisionsOf(result.runId)).toEqual([]);
    expect(JSON.stringify(model.requests[1]?.contents.at(-1))).toContain(
      'There is no tool named \\"propose_rule\\"',
    );
  });

  it('returns a tool error to the model and continues the run', async () => {
    const { model, runtime } = runtimeFor([
      { calls: [{ name: 'get_my_orders', args: {} }] },
      { text: 'You have no orders yet.' },
    ]);

    const result = await runtime.run(salesAgent, request);

    expect(result).toMatchObject({ outcome: 'reply', text: 'You have no orders yet.' });
    expect(model.requests[1]?.contents.at(-1)?.parts).toEqual([
      {
        functionResponse: {
          name: 'get_my_orders',
          response: { status: 'error', error: 'You have no orders yet' },
        },
      },
    ]);
    expect((await tracesOf(result.runId))[0]?.toolCalls).toEqual([
      { name: 'get_my_orders', args: {}, status: 'error' },
    ]);
  });

  it('escalates after two guard rejections without asking the model again', async () => {
    const { model, runtime } = runtimeFor([offer('700'), offer('1200'), { text: 'unused' }]);

    const result = await runtime.run(salesAgent, request);

    expect(result).toMatchObject({ outcome: 'escalated', reason: 'guard_rejections' });
    expect(model.requests).toHaveLength(2);
    expect(model.requests[1]?.contents.at(-1)?.parts).toEqual([
      {
        functionResponse: {
          name: 'offer_price',
          response: { status: 'rejected', reason: 'too_low', counteroffer: '850.00' },
        },
      },
    ]);
    expect((await tracesOf(result.runId)).map((trace) => trace.outcome)).toEqual([
      'tool_calls',
      'escalated',
    ]);
    expect(await decisionsOf(result.runId)).toMatchObject([
      { result: 'rejected', reason: 'too_low', counteroffer: { value: '850.00' } },
      { result: 'rejected', reason: 'above_asking', counteroffer: { value: '1000.00' } },
    ]);
  });

  it('traces a failed model call and passes the failure on', async () => {
    const quota = new AppError('QUOTA_EXHAUSTED', 'Daily budget spent');
    const { runtime } = runtimeFor([offer('950'), { error: quota }]);

    await expect(runtime.run(salesAgent, request)).rejects.toBe(quota);

    const traces = await withShop(db, shopId, (tx) =>
      tx.select().from(agentTraces).where(eq(agentTraces.outcome, 'failed')),
    );
    expect(traces).toMatchObject([{ step: 2, inputTokens: 0, outputTokens: 0, toolCalls: [] }]);
  });

  it('escalates when the model keeps calling tools past the step limit', async () => {
    const { model, runtime } = runtimeFor(Array.from({ length: 7 }, () => offer('1000')));

    const result = await runtime.run(salesAgent, request);

    expect(result).toMatchObject({ outcome: 'escalated', reason: 'step_limit' });
    expect(model.requests).toHaveLength(6);
    expect((await tracesOf(result.runId)).map((trace) => trace.outcome)).toEqual([
      ...Array.from({ length: 5 }, () => 'tool_calls'),
      'escalated',
    ]);
  });

  it('escalates an empty reply', async () => {
    const { runtime } = runtimeFor([{ text: '  ' }]);
    expect(await runtime.run(salesAgent, request)).toMatchObject({
      outcome: 'escalated',
      reason: 'empty_reply',
    });
  });

  it('holds an owner-confirms action as a pending request', async () => {
    const ownerAssistant: AgentDefinition = {
      name: 'owner_assistant',
      prompt: { id: 'owner.test', version: 1, text: 'You help the owner.' },
      tier: 'smart',
      priority: 'owner',
    };
    const { runtime } = runtimeFor([
      { calls: [{ name: 'propose_rule', args: { rule: 'Close on Sundays' } }] },
      { text: 'Sent for your approval.' },
    ]);

    const result = await runtime.run(ownerAssistant, request);

    expect(proposeRuleHandler).not.toHaveBeenCalled();
    expect(await decisionsOf(result.runId)).toMatchObject([
      {
        agent: 'owner_assistant',
        tool: 'propose_rule',
        proposed: { rule: 'Close on Sundays' },
        limits: null,
        result: 'needs_owner',
        reason: 'owner_confirms',
        ownerStatus: 'pending',
      },
    ]);
  });
});

describe('PolicyGuard', () => {
  const context = {
    shopId: '',
    runId: '00000000-0000-4000-8000-0000000000d1',
    agent: 'operations' as const,
    actor: { kind: 'system' as const },
    tool: 'extend_deadline',
  };

  it('sends a second deadline extension to the owner as a pending request', async () => {
    const scoped = { ...context, shopId };
    const proposal = { value: 30, reason: 'Pays after work', evidenceIds: ['msg:9'] };

    const orderId = '00000000-0000-4000-8000-0000000000e1';

    const outcome = await guard.checkDeadlineExtension(scoped, proposal, {
      orderId,
      extensionsMade: 1,
    });

    expect(outcome).toEqual({
      decision: { result: 'needs_owner', reason: 'already_extended' },
      toolResult: { status: 'awaiting_owner' },
    });
    expect(await decisionsOf(context.runId)).toMatchObject([
      {
        proposed: { orderId, value: 30 },
        limits: { extensionsMade: 1 },
        result: 'needs_owner',
        counteroffer: null,
        ownerStatus: 'pending',
      },
    ]);
  });

  it('records a far-delivery price above the cap as waiting for the owner', async () => {
    const scoped = { ...context, shopId, runId: '00000000-0000-4000-8000-0000000000d2' };
    const proposal = { value: Money.of('1200'), reason: 'Roadworks', evidenceIds: [] };
    const deliveryLimits = { formulaPayout: Money.of('300'), cap: Money.of('1000') };

    const outcome = await guard.checkDeliveryPrice(scoped, proposal, deliveryLimits);

    expect(outcome.toolResult).toEqual({ status: 'awaiting_owner' });
    expect(await decisionsOf(scoped.runId)).toMatchObject([
      { limits: { formulaPayout: '300.00', cap: '1000.00' }, ownerStatus: 'pending' },
    ]);
  });
});
