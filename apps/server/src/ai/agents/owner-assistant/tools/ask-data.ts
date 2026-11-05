import { z } from 'zod';
import type { InsightsService } from '../../../../modules/insights/insights.service';
import { defineTool, type Tool } from '../../../tool';

export interface AskDataDeps {
  insights: Pick<InsightsService, 'ask'>;
}

/** What `ask_data` returns, which the assistant reads back to draw a chart. */
export const askDataOutputSchema = z.object({
  title: z.string(),
  columns: z.array(z.string()),
  rows: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))),
});

export function askDataTool(deps: AskDataDeps): Tool {
  return defineTool({
    name: 'ask_data',
    description:
      'Runs one read-only PostgreSQL SELECT over the reporting views and returns up to 200 rows. ' +
      'Anything else is refused before it reaches the database.',
    agents: ['owner_assistant'],
    autonomy: 'automatic',
    input: z.object({
      sql: z.string().trim().min(10).max(2000),
      title: z.string().trim().min(2).max(80).describe('A short title for a chart of the result.'),
    }),
    handle: async ({ sql, title }, context) => {
      const result = await deps.insights.ask(context.shopId, sql);
      return { status: 'ok', output: { title, ...result } };
    },
  });
}
