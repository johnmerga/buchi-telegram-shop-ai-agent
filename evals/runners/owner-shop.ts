import { OwnerAssistant } from '@buchi/server/ai/agents/owner-assistant/owner-assistant';
import { ownerAssistantTools } from '@buchi/server/ai/agents/owner-assistant/owner-assistant-tools';
import { OwnerApprovals } from '@buchi/server/ai/approvals/owner-approvals.service';
import { DecisionsRepo } from '@buchi/server/ai/guard/decisions.repo';
import { PolicyGuard } from '@buchi/server/ai/guard/policy-guard.service';
import type { LanguageModel } from '@buchi/server/ai/language-model';
import { ToolRegistry } from '@buchi/server/ai/registry';
import { AgentRuntime, type RunResult } from '@buchi/server/ai/runtime';
import { TracesRepo } from '@buchi/server/ai/traces.repo';
import type { Database } from '@buchi/server/db/client';
import { CatalogRepo } from '@buchi/server/modules/catalog/catalog.repo';
import { CatalogService } from '@buchi/server/modules/catalog/catalog.service';
import { CustomersRepo } from '@buchi/server/modules/customers/customers.repo';
import { CustomersService } from '@buchi/server/modules/customers/customers.service';
import { SessionsRepo } from '@buchi/server/modules/customers/sessions.repo';
import { DeliverySettingsRepo } from '@buchi/server/modules/delivery/delivery-settings.repo';
import { DeliveryService } from '@buchi/server/modules/delivery/delivery.service';
import { TimersRepo } from '@buchi/server/modules/jobs/timers.repo';
import { TimerService } from '@buchi/server/modules/jobs/timers.service';
import { OrdersRepo } from '@buchi/server/modules/orders/orders.repo';
import { OrderService } from '@buchi/server/modules/orders/orders.service';
import { StockHoldsRepo } from '@buchi/server/modules/orders/stock-holds.repo';
import { OwnerAlerts } from '@buchi/server/modules/owner/owner-alerts.service';
import { ReportingRepo } from '@buchi/server/modules/reporting/reporting.repo';
import { ReportingService } from '@buchi/server/modules/reporting/reporting.service';
import { OwnerRulesRepo } from '@buchi/server/modules/rules/rules.repo';
import { OwnerRulesService } from '@buchi/server/modules/rules/rules.service';
import { NegotiationService } from '@buchi/server/modules/sales/negotiation.service';
import { NegotiationsRepo } from '@buchi/server/modules/sales/negotiations.repo';
import { ShopsRepo } from '@buchi/server/modules/shops/shops.repo';
import { ShopsService } from '@buchi/server/modules/shops/shops.service';
import { EventBus } from '@buchi/server/shared/events';
import { pino } from 'pino';

const offline = () => Promise.reject(new Error('Evaluations do not call Telegram or the network'));

/**
 * The owner assistant as the server wires it, on the evaluation database, with a fixed clock.
 * Owner messages and charts stay in the process, because the suites measure the rules and the
 * rows, not delivery. Each run's result is kept, so a suite can read the rows the agent saw.
 */
export function createOwnerShop(db: Database, model: LanguageModel, now: () => Date) {
  const logger = pino({ level: 'silent' });
  const messenger = { send: () => Promise.resolve(1), copy: offline, edit: offline };
  const shops = new ShopsService(db, new ShopsRepo(db), { verifyPostingRights: offline });
  const events = new EventBus(logger);
  const catalog = new CatalogService(
    db,
    new CatalogRepo(),
    shops,
    { publish: offline },
    'evals_bot',
    { enqueue: () => Promise.resolve() },
    events,
  );
  const rules = new OwnerRulesService(db, new OwnerRulesRepo(), now);
  const orders = new OrderService(
    db,
    new OrdersRepo(),
    events,
    new TimerService(new TimersRepo(db), logger),
    new NegotiationService(db, new NegotiationsRepo()),
    rules,
    new StockHoldsRepo(),
  );
  const delivery = new DeliveryService(
    db,
    new DeliverySettingsRepo(),
    shops,
    { between: offline },
    () => Promise.resolve(1),
    rules,
  );
  const reporting = new ReportingService(db, new ReportingRepo(db), now);
  const decisions = new DecisionsRepo();
  const guard = new PolicyGuard(db, decisions);
  const tools = ownerAssistantTools({ rules, delivery, catalog, reporting, now });
  const runtime = new AgentRuntime(
    model,
    new ToolRegistry(tools.tools, guard, logger),
    db,
    new TracesRepo(),
    () => performance.now(),
  );
  const runs: RunResult[] = [];
  const recordingRuntime: Pick<AgentRuntime, 'run'> = {
    run: async (agent, request) => {
      const result = await runtime.run(agent, request);
      runs.push(result);
      return result;
    },
  };
  const ownerAlerts = new OwnerAlerts(shops, messenger, logger);
  const approvals = new OwnerApprovals(db, decisions, tools.approvals, ownerAlerts, logger, now);
  return {
    assistant: new OwnerAssistant(
      recordingRuntime,
      approvals,
      { render: () => Promise.resolve(new Uint8Array()) },
      logger,
      now,
    ),
    runs,
    shops,
    catalog,
    customers: new CustomersService(db, new CustomersRepo(), new SessionsRepo(db)),
    orders,
    reporting,
  };
}
