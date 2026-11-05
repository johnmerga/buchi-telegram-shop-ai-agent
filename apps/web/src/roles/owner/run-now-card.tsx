import type { DailyReportName } from '@buchi/shared';
import { Alert } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Card, CardTitle } from '../../components/ui/card';
import { useRunReport } from './dashboard-api';

const reports: { name: DailyReportName; label: string; schedule: string }[] = [
  { name: 'morning-brief', label: 'Morning brief', schedule: 'every day at 8:00 AM' },
  { name: 'evening-summary', label: 'Evening summary', schedule: 'every day at 6:00 PM' },
];

/** Sends the shop's daily reports to its owners now, without waiting for their time. */
export function RunNowCard({ shopId }: { shopId: string }) {
  const run = useRunReport(shopId);
  return (
    <Card className="flex flex-col gap-3">
      <CardTitle>Daily reports · ዕለታዊ ሪፖርቶች</CardTitle>
      <p className="text-sm text-muted-foreground">
        Buchi sends these to your Telegram on its own. Run now sends one at once, for example to see
        today’s numbers.
      </p>
      {reports.map((report) => (
        <div key={report.name} className="flex items-center justify-between gap-2">
          <div className="text-sm">
            <p className="font-medium">{report.label}</p>
            <p className="text-xs text-muted-foreground">{report.schedule}</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={run.isPending}
            aria-label={`Run ${report.label} now`}
            onClick={() => {
              run.mutate(report.name);
            }}
          >
            Run now
          </Button>
        </div>
      ))}
      {run.isSuccess && <Alert tone="info">Sent to your Telegram.</Alert>}
      {run.isError && <Alert tone="error">{run.error.message}</Alert>}
    </Card>
  );
}
