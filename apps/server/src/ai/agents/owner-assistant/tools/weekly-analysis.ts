import { z } from 'zod';
import type { DeliveryService } from '../../../../modules/delivery/delivery.service';
import type { ReportingService } from '../../../../modules/reporting/reporting.service';
import { defineTool, type Tool } from '../../../tool';

export interface WeeklyAnalysisDeps {
  reporting: Pick<ReportingService, 'weeklyFindings'>;
  delivery: Pick<DeliveryService, 'savedSettings'>;
}

/** The fixed analysis queries, with the delivery settings a suggestion may change. */
export function weeklyAnalysisTool(deps: WeeklyAnalysisDeps): Tool {
  return defineTool({
    name: 'weekly_analysis',
    description:
      "Runs the fixed weekly analysis of the shop's last four weeks: delivery margins by " +
      'distance, sales and stock by size, unmet demand, waitlists, and the delivery settings.',
    agents: ['owner_assistant'],
    autonomy: 'automatic',
    input: z.object({}),
    handle: async (_input, context) => {
      const [findings, { settings }] = await Promise.all([
        deps.reporting.weeklyFindings(context.shopId),
        deps.delivery.savedSettings(context.shopId),
      ]);
      return { status: 'ok', output: { ...findings, deliverySettings: settings } };
    },
  });
}
