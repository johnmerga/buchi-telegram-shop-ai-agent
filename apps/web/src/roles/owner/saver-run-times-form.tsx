import { saverRunTimesSchema } from '@buchi/shared';
import { useState, type SubmitEvent } from 'react';
import { Alert } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Card, CardTitle } from '../../components/ui/card';
import { Field } from '../../components/ui/field';
import { fieldErrors } from '../../lib/form';
import { useT } from '../../lib/i18n';
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
  const { t } = useT();

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
        <CardTitle>{t('saver.title')}</CardTitle>
        <p className="text-sm text-muted-foreground">{t('saver.hint')}</p>
        {!enabled && <Alert tone="info">{t('saver.pricesFirst')}</Alert>}
        <Field
          label={t('saver.times')}
          placeholder="10:00, 14:00"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
          }}
          error={error}
          disabled={!enabled}
        />
        {save.isError && <Alert tone="error">{save.error.message}</Alert>}
        {save.isSuccess && <Alert tone="info">{t('saver.saved')}</Alert>}
        <Button type="submit" disabled={!enabled || save.isPending}>
          {t('saver.save')}
        </Button>
      </form>
    </Card>
  );
}
