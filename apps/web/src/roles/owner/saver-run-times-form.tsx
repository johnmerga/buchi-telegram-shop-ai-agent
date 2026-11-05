import { saverRunTimesSchema } from '@buchi/shared';
import { useState, type SubmitEvent } from 'react';
import { Alert } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Card, CardTitle } from '../../components/ui/card';
import { Field } from '../../components/ui/field';
import { fieldErrors } from '../../lib/form';
import { useSaveSaverRunTimes } from './owner-api';

/** Saver run times as one comma-separated line, such as "10:00, 14:00". */
export function SaverRunTimesForm({
  shopId,
  saved,
  enabled,
}: {
  shopId: string;
  saved: string[];
  enabled: boolean;
}) {
  const [text, setText] = useState(saved.join(', '));
  const [error, setError] = useState<string>();
  const save = useSaveSaverRunTimes(shopId);

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    const times = text
      .split(',')
      .map((time) => time.trim())
      .filter((time) => time !== '');
    const input = saverRunTimesSchema.safeParse({ times });
    setError(input.success ? undefined : Object.values(fieldErrors(input.error))[0]);
    if (input.success) save.mutate(input.data);
  };

  return (
    <Card>
      <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
        <CardTitle>Saver runs · የቁጠባ ጉዞዎች</CardTitle>
        <p className="text-sm text-muted-foreground">
          Saver orders wait and go out together at these Addis Ababa times. Leave it empty to stop
          Saver runs.
        </p>
        {!enabled && <Alert tone="info">Save the delivery prices first.</Alert>}
        <Field
          label="Run times (24-hour)"
          placeholder="10:00, 14:00"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
          }}
          error={error}
          disabled={!enabled}
        />
        {save.isError && <Alert tone="error">{save.error.message}</Alert>}
        {save.isSuccess && <Alert tone="info">Saver run times saved.</Alert>}
        <Button type="submit" disabled={!enabled || save.isPending}>
          Save run times
        </Button>
      </form>
    </Card>
  );
}
