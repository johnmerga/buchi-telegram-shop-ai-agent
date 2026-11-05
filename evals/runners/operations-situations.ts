import type { Situation } from '@buchi/server/ai/agents/operations/situation.domain';
import type { LanguageModel } from '@buchi/server/ai/language-model';
import type { Database } from '@buchi/server/db/client';
import { agentDecisions, agentTraces } from '@buchi/server/db/schema';
import { withShop } from '@buchi/server/db/with-shop';
import { z } from 'zod';
import { defineSuite, type Suite } from '../harness/suite';
import { createOperationsShop } from './operations-shop';
import { idsOf, NOW, seedJob, seedOrder, seedProduct, type CaseIds } from './operations-seed';

const CUSTOMER = { telegramUserId: 1, name: 'Hana Tesfaye' };

const input = z.discriminatedUnion('situation', [
  z.strictObject({
    situation: z.literal('payment_deadline'),
    message: z.string().min(1),
    extensionsMade: z.number().int().min(0),
  }),
  z.strictObject({ situation: z.literal('driver_report'), message: z.string().min(1) }),
  z.strictObject({ situation: z.literal('delivery_late') }),
  z.strictObject({ situation: z.literal('no_driver_accepted') }),
  z.strictObject({
    situation: z.literal('delivery_problem'),
    problem: z.enum(['wrong_size', 'damaged', 'other']),
    wantedSizeInStock: z.boolean(),
  }),
  z.strictObject({ situation: z.literal('waitlist') }),
]);
type Input = z.output<typeof input>;

const toolNames = z.array(z.string().min(1));
const expected = z.strictObject({ automatic: toolNames, ownerConfirms: toolNames });

interface Actual {
  outcome: string;
  /** Each tool the agent called, with the status the registry or the guard gave it. */
  calls: { name: string; status: string }[];
  pendingDecisions: string[];
}

/**
 * Measures the operations agent on each row of the design doc's problem-handling table: the
 * action it takes, and whether that action ran at once or waited for the owner.
 */
export function operationsSituationsSuite(db: Database): Suite {
  let messageId = 0;
  const nextMessageId = () => (messageId += 1);
  async function run(testCase: Input, model: LanguageModel): Promise<Actual> {
    const shop = createOperationsShop(db, model, () => NOW, nextMessageId);
    const shopId = await shop.shops.create(1, { name: 'Evaluation shop' });
    const ids = idsOf(JSON.stringify(testCase));
    const customer = await shop.customers.identify(shopId, CUSTOMER.telegramUserId, CUSTOMER.name);
    const situation = await seedSituation(db, shop, shopId, ids, customer.id, testCase);

    const outcome = await shop.agent.handle(situation);

    const [traces, decisions] = await withShop(
      db,
      shopId,
      async (tx) =>
        [
          await tx.select().from(agentTraces).orderBy(agentTraces.step),
          await tx.select().from(agentDecisions),
        ] as const,
    );
    return {
      outcome,
      calls: traces.flatMap((trace) =>
        trace.toolCalls.map(({ name, status }) => ({ name, status })),
      ),
      pendingDecisions: decisions.filter((d) => d.ownerStatus === 'pending').map((d) => d.tool),
    };
  }

  return defineSuite({
    name: 'operations-situations',
    dataset: 'operations-situations.jsonl',
    input,
    expected,
    metrics: {
      actionMatch: { atLeast: 0.8 },
      autonomyMatch: { atLeast: 0.9 },
    },
    run,
    score: (actual, { expected: wanted }) => {
      const acted = actual.calls.filter((c) => c.status === 'ok' || c.status === 'awaiting_owner');
      const names = [...new Set(acted.map((call) => call.name))].sort();
      const expectedNames = [...new Set([...wanted.automatic, ...wanted.ownerConfirms])].sort();
      const ranAtOnce = wanted.automatic.every((name) =>
        acted.some((call) => call.name === name && call.status === 'ok'),
      );
      const heldForOwner = wanted.ownerConfirms.every(
        (name) =>
          acted.some((call) => call.name === name && call.status === 'awaiting_owner') &&
          actual.pendingDecisions.includes(name),
      );
      return {
        actionMatch: JSON.stringify(names) === JSON.stringify(expectedNames) ? 1 : 0,
        autonomyMatch: ranAtOnce && heldForOwner ? 1 : 0,
      };
    },
  });
}

type OperationsShop = ReturnType<typeof createOperationsShop>;

/** Seeds the records of one situation with fixed IDs and times, and builds it as the server does. */
async function seedSituation(
  db: Database,
  shop: OperationsShop,
  shopId: string,
  ids: CaseIds,
  customerId: string,
  testCase: Input,
): Promise<Situation> {
  const soldOut = testCase.situation === 'waitlist';
  const size43 = testCase.situation === 'delivery_problem' && testCase.wantedSizeInStock ? 3 : 0;
  await seedProduct(db, shopId, ids, { size42: 5, size43: soldOut ? 0 : size43 });
  const order = (status: Parameters<typeof seedOrder>[3]['status'], extensions = 0) =>
    seedOrder(db, shopId, ids, {
      customerId,
      status,
      paymentDeadline: new Date(NOW.getTime() + 20 * 60_000),
      deadlineExtensions: extensions,
    });

  switch (testCase.situation) {
    case 'payment_deadline':
      await order('awaiting_payment', testCase.extensionsMade);
      return shop.situations.paymentDeadline(shopId, ids.order, CUSTOMER, testCase.message);
    case 'driver_report':
    case 'delivery_late': {
      await order('out_for_delivery');
      await seedJob(db, shopId, ids, 'picked_up');
      const trip = await shop.trips.trip(shopId, ids.job);
      if (!trip) throw new Error('The seeded trip is missing');
      return testCase.situation === 'driver_report'
        ? shop.situations.driverReport(shopId, trip, testCase.message)
        : shop.situations.deliveryLate(shopId, trip);
    }
    case 'no_driver_accepted': {
      await order('dispatching');
      await seedJob(db, shopId, ids, 'offered');
      const offer = await shop.trips.openOffer(shopId, ids.offer);
      if (!offer) throw new Error('The seeded offer is missing');
      return shop.situations.noDriverAccepted(shopId, offer);
    }
    case 'delivery_problem': {
      await order('delivered');
      await seedJob(db, shopId, ids, 'delivered');
      const wanted = testCase.problem === 'wrong_size' ? '43' : undefined;
      return shop.situations.deliveryProblem(shopId, ids.order, testCase.problem, wanted);
    }
    case 'waitlist': {
      const situation = await shop.situations.waitlist(shopId, ids.size43, 10);
      if (!situation) throw new Error('The seeded size is missing');
      return situation;
    }
  }
}
