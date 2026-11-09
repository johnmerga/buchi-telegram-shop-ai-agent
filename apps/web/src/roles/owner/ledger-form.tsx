import { ledgerConnectSchema, type LedgerSettings } from '@buchi/shared';
import { useState, type SubmitEvent } from 'react';
import { Alert } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Card, CardTitle } from '../../components/ui/card';
import { Field } from '../../components/ui/field';
import { fieldErrors } from '../../lib/form';
import { useT } from '../../lib/i18n';
import { useConnectLedger } from './dashboard-api';

/** The Google Sheets ledger: which sheet, whom to share it with, and how sending goes. */
export function LedgerForm({ shopId, saved }: { shopId: string; saved: LedgerSettings }) {
  const [spreadsheetId, setSpreadsheetId] = useState(saved.spreadsheetId ?? '');
  const [error, setError] = useState<string>();
  const connect = useConnectLedger(shopId);
  const { t, formatTime } = useT();

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    const trimmed = spreadsheetId.trim();
    const input = ledgerConnectSchema.safeParse({ spreadsheetId: trimmed === '' ? null : trimmed });
    setError(input.success ? undefined : Object.values(fieldErrors(input.error))[0]);
    if (input.success) connect.mutate(input.data);
  };

  return (
    <Card>
      <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
        <CardTitle>{t('ledger.title')}</CardTitle>
        <p className="text-sm text-muted-foreground">{t('ledger.hint')}</p>
        {saved.serviceAccountEmail ? (
          <p className="text-sm">
            {t('ledger.shareWith')}{' '}
            <span className="font-mono break-all">{saved.serviceAccountEmail}</span>
          </p>
        ) : (
          <Alert tone="info">{t('ledger.noAccount')}</Alert>
        )}
        <Field
          label={t('ledger.spreadsheetId')}
          hint={t('ledger.spreadsheetHint')}
          value={spreadsheetId}
          onChange={(e) => {
            setSpreadsheetId(e.target.value);
          }}
          error={error}
        />
        <p className="text-xs text-muted-foreground">
          {t('ledger.waiting', { count: saved.pending })}
          {saved.lastSentAt && ` · ${t('ledger.lastSent', { time: formatTime(saved.lastSentAt) })}`}
        </p>
        {saved.lastError && (
          <Alert tone="error">{t('ledger.lastError', { error: saved.lastError })}</Alert>
        )}
        {connect.isError && <Alert tone="error">{connect.error.message}</Alert>}
        {connect.isSuccess && <Alert tone="info">{t('ledger.saved')}</Alert>}
        <Button type="submit" disabled={connect.isPending}>
          {t('ledger.save')}
        </Button>
      </form>
    </Card>
  );
}
