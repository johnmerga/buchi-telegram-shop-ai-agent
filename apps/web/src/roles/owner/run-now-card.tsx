import type { DailyReportName } from '@buchi/shared';
import { Alert } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Card, CardTitle } from '../../components/ui/card';
import { useT, type MessageKey } from '../../lib/i18n';
import { useRunReport } from './dashboard-api';

const reports: { name: DailyReportName; label: MessageKey; schedule: MessageKey }[] = [
  { name: 'morning-brief', label: 'reports.morning', schedule: 'reports.morningSchedule' },
  { name: 'evening-summary', label: 'reports.evening', schedule: 'reports.eveningSchedule' },
];

/** Sends the shop's daily reports to its owners now, without waiting for their time. */
export function RunNowCard({ shopId }: { shopId: string }) {
  const run = useRunReport(shopId);
  const { t } = useT();
  return (
    <Card className="flex flex-col gap-3">
      <CardTitle>{t('reports.title')}</CardTitle>
      <p className="text-sm text-muted-foreground">{t('reports.hint')}</p>
      {reports.map((report) => (
        <div key={report.name} className="flex items-center justify-between gap-2">
          <div className="text-sm">
            <p className="font-medium">{t(report.label)}</p>
            <p className="text-xs text-muted-foreground">{t(report.schedule)}</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={run.isPending}
            aria-label={t('reports.runLabel', { report: t(report.label) })}
            onClick={() => {
              run.mutate(report.name);
            }}
          >
            {t('reports.run')}
          </Button>
        </div>
      ))}
      {run.isSuccess && <Alert tone="info">{t('reports.sent')}</Alert>}
      {run.isError && <Alert tone="error">{run.error.message}</Alert>}
    </Card>
  );
}
