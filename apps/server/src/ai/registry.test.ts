import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AppError } from '../shared/errors';
import { ToolRegistry } from './registry';
import { defineTool, type RunContext, type ToolResult } from './tool';

const ok: ToolResult = { status: 'ok', output: {} };

function tool(
  name: string,
  agents: ('sales' | 'operations' | 'owner_assistant')[],
  handle: () => Promise<ToolResult> = () => Promise.resolve(ok),
  autonomy: 'automatic' | 'owner_confirms' = 'automatic',
) {
  const handler = vi.fn(handle);
  const definition = defineTool({
    name,
    description: name,
    agents,
    autonomy,
    input: z.object({ amount: z.number().int().optional() }),
    handle: handler,
  });
  return { definition, handler };
}

const sales: RunContext = {
  shopId: 'shop',
  runId: 'run',
  agent: 'sales',
  actor: { kind: 'telegram_user', telegramUserId: 7 },
};

function registryWith(...tools: ReturnType<typeof tool>[]) {
  const guard = {
    requestOwnerConfirmation: vi.fn(() =>
      Promise.resolve<ToolResult>({ status: 'awaiting_owner' }),
    ),
  };
  const registry = new ToolRegistry(
    tools.map((t) => t.definition),
    guard,
    pino({ level: 'silent' }),
  );
  return { registry, guard };
}

describe('ToolRegistry', () => {
  it('gives each agent only its own tools', () => {
    const { registry } = registryWith(
      tool('search_products', ['sales']),
      tool('propose_rule', ['owner_assistant']),
      tool('escalate', ['sales', 'operations']),
    );

    expect(registry.declarationsFor('sales').map((d) => d.name)).toEqual([
      'search_products',
      'escalate',
    ]);
    expect(registry.declarationsFor('owner_assistant').map((d) => d.name)).toEqual([
      'propose_rule',
    ]);
  });

  it("never runs another agent's tool, even when the model names it", async () => {
    const ownerTool = tool('propose_rule', ['owner_assistant']);
    const { registry, guard } = registryWith(ownerTool);

    const result = await registry.execute({ name: 'propose_rule', args: {} }, sales);

    expect(result).toEqual({ status: 'error', error: 'There is no tool named "propose_rule".' });
    expect(ownerTool.handler).not.toHaveBeenCalled();
    expect(guard.requestOwnerConfirmation).not.toHaveBeenCalled();
  });

  it('answers an unknown tool the same way', async () => {
    const { registry } = registryWith();
    expect(await registry.execute({ name: 'drop_tables' }, sales)).toEqual({
      status: 'error',
      error: 'There is no tool named "drop_tables".',
    });
  });

  it('returns invalid arguments to the model without running the tool', async () => {
    const lookup = tool('search_products', ['sales']);
    const { registry } = registryWith(lookup);

    const result = await registry.execute(
      { name: 'search_products', args: { amount: 'x' } },
      sales,
    );

    expect(result).toMatchObject({
      status: 'error',
      error: expect.stringContaining('amount') as unknown,
    });
    expect(lookup.handler).not.toHaveBeenCalled();
  });

  it('runs an automatic tool with the call context', async () => {
    const lookup = tool('search_products', ['sales']);
    const { registry } = registryWith(lookup);

    expect(await registry.execute({ name: 'search_products', args: { amount: 2 } }, sales)).toEqual(
      ok,
    );
    expect(lookup.handler).toHaveBeenCalledWith(
      { amount: 2 },
      { ...sales, tool: 'search_products' },
    );
  });

  it('turns an owner-confirms call into a pending request instead of running it', async () => {
    const refund = tool('propose_refund', ['operations'], undefined, 'owner_confirms');
    const { registry, guard } = registryWith(refund);
    const operations = { ...sales, agent: 'operations' as const };

    const result = await registry.execute(
      { name: 'propose_refund', args: { amount: 300 } },
      operations,
    );

    expect(result).toEqual({ status: 'awaiting_owner' });
    expect(guard.requestOwnerConfirmation).toHaveBeenCalledWith(
      { ...operations, tool: 'propose_refund' },
      { amount: 300 },
    );
    expect(refund.handler).not.toHaveBeenCalled();
  });

  it('returns an expected failure to the model with its message', async () => {
    const failing = tool('get_my_orders', ['sales'], () =>
      Promise.reject(new AppError('NOT_FOUND', 'No orders yet')),
    );
    const { registry } = registryWith(failing);

    expect(await registry.execute({ name: 'get_my_orders' }, sales)).toEqual({
      status: 'error',
      error: 'No orders yet',
    });
  });

  it('hides the details of an unexpected failure from the model', async () => {
    const failing = tool('get_my_orders', ['sales'], () =>
      Promise.reject(new Error('connection refused at 10.0.0.3')),
    );
    const { registry } = registryWith(failing);

    expect(await registry.execute({ name: 'get_my_orders' }, sales)).toEqual({
      status: 'error',
      error: 'The tool failed for an internal reason.',
    });
  });

  describe('in a situation run', () => {
    const inSituation = '3f2a9c00-0000-4000-8000-000000000001';
    const elsewhere = 'aa000000-0000-4000-8000-000000000002';
    const operations: RunContext = {
      ...sales,
      agent: 'operations',
      actor: { kind: 'situation', recordIds: [inSituation] },
    };

    function orderTool(autonomy: 'automatic' | 'owner_confirms') {
      const handler = vi.fn(() => Promise.resolve(ok));
      const definition = defineTool({
        name: 'message_customer',
        description: 'Messages a customer',
        agents: ['operations'],
        autonomy,
        input: z.object({ orderId: z.uuid(), text: z.string() }),
        handle: handler,
      });
      return { definition, handler };
    }

    it('runs a tool on a record that the situation names', async () => {
      const message = orderTool('automatic');
      const { registry } = registryWith(message);
      const args = { orderId: inSituation, text: 'Hello' };

      expect(await registry.execute({ name: 'message_customer', args }, operations)).toEqual(ok);
      expect(message.handler).toHaveBeenCalled();
    });

    it.each(['automatic', 'owner_confirms'] as const)(
      'refuses an %s tool on any other record',
      async (autonomy) => {
        const message = orderTool(autonomy);
        const { registry, guard } = registryWith(message);
        const args = { orderId: elsewhere, text: 'Hello' };

        expect(await registry.execute({ name: 'message_customer', args }, operations)).toEqual({
          status: 'error',
          error: 'You can act only on the records of this situation.',
        });
        expect(message.handler).not.toHaveBeenCalled();
        expect(guard.requestOwnerConfirmation).not.toHaveBeenCalled();
      },
    );
  });

  it('refuses two tools with the same name', () => {
    expect(() =>
      registryWith(tool('escalate', ['sales']), tool('escalate', ['operations'])),
    ).toThrow('registered twice');
  });
});
