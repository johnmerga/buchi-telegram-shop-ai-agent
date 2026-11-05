import { dailyReportNameSchema, ledgerConnectSchema } from '@buchi/shared';
import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { parseInput } from '../../http/validate';
import type { DailyReports } from './daily-reports.service';
import type { InsightsService } from './insights.service';
import type { LedgerService } from './ledger.service';

const shopParams = z.object({ shopId: z.uuid() });
const reportParams = shopParams.extend({ report: dailyReportNameSchema });

/** The owner's **Insights**, the ledger settings, and **Run now** for the shop's daily reports. */
export function createReportsRouter(deps: {
  insights: InsightsService;
  ledger: LedgerService;
  reports: Pick<DailyReports, 'runNow'>;
  requireAuth: RequestHandler;
  requireShopOwner: RequestHandler;
}): Router {
  const { insights, ledger, reports, requireAuth, requireShopOwner } = deps;
  const router = Router();
  const owner = [requireAuth, requireShopOwner];

  router.get('/shops/:shopId/insights', ...owner, async (req, res) => {
    res.json(await insights.insights(parseInput(shopParams, req.params).shopId));
  });

  router.get('/shops/:shopId/ledger', ...owner, async (req, res) => {
    res.json(await ledger.settings(parseInput(shopParams, req.params).shopId));
  });

  router.put('/shops/:shopId/ledger', ...owner, async (req, res) => {
    const { shopId } = parseInput(shopParams, req.params);
    const { spreadsheetId } = parseInput(ledgerConnectSchema, req.body);
    await ledger.connect(shopId, spreadsheetId);
    res.json(await ledger.settings(shopId));
  });

  /**
   * Sends the shop's own report to its owners now. It needs no job secret, because it runs only
   * for a shop the caller owns and never marks the day's report as sent.
   */
  router.post('/shops/:shopId/reports/:report', ...owner, async (req, res) => {
    const { shopId, report } = parseInput(reportParams, req.params);
    await reports.runNow(shopId, report);
    res.sendStatus(204);
  });

  return router;
}
