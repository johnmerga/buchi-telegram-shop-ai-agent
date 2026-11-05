import { ledgerConnectSchema, type LedgerSettings } from '@buchi/shared';
import { useState, type SubmitEvent } from 'react';
import { Alert } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Card, CardTitle } from '../../components/ui/card';
import { Field } from '../../components/ui/field';
import { fieldErrors } from '../../lib/form';
import { formatTime } from '../../lib/labels';
import { useConnectLedger } from './dashboard-api';

/** The Google Sheets ledger: which sheet, whom to share it with, and how sending goes. */
export function LedgerForm({ shopId, saved }: { shopId: string; saved: LedgerSettings }) {
  const [spreadsheetId, setSpreadsheetId] = useState(saved.spreadsheetId ?? '');
  const [error, setError] = useState<string>();
  const connect = useConnectLedger(shopId);

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
        <CardTitle>Google Sheets ledger · የሽያጭ መዝገብ</CardTitle>
        <p className="text-sm text-muted-foreground">
          Buchi adds a row to the <b>Sales</b> tab for every paid order and one to the <b>Daily</b>{' '}
          tab each evening. Create both tabs in your sheet first.
        </p>
        {saved.serviceAccountEmail ? (
          <p className="text-sm">
            Share the sheet as <b>Editor</b> with{' '}
            <span className="break-all font-mono">{saved.serviceAccountEmail}</span>.
          </p>
        ) : (
          <Alert tone="info">
            The server has no Google account yet, so rows wait here and arrive once it does.
          </Alert>
        )}
        <Field
          label="Spreadsheet ID"
          hint="The part of the sheet’s address between /d/ and /edit. Leave empty to stop."
          value={spreadsheetId}
          onChange={(e) => {
            setSpreadsheetId(e.target.value);
          }}
          error={error}
        />
        <p className="text-xs text-muted-foreground">
          {saved.pending} rows waiting
          {saved.lastSentAt && ` · last sent ${formatTime(saved.lastSentAt)}`}
        </p>
        {saved.lastError && <Alert tone="error">Last attempt failed: {saved.lastError}</Alert>}
        {connect.isError && <Alert tone="error">{connect.error.message}</Alert>}
        {connect.isSuccess && <Alert tone="info">Ledger saved.</Alert>}
        <Button type="submit" disabled={connect.isPending}>
          Save ledger
        </Button>
      </form>
    </Card>
  );
}
