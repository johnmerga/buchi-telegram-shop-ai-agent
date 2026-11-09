import { connectChannelSchema } from '@buchi/shared';
import { useState, type SubmitEvent } from 'react';
import { Alert } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Field } from '../../components/ui/field';
import { fieldErrors } from '../../lib/form';
import { useT } from '../../lib/i18n';
import { useConnectChannel } from './owner-api';
import { StepTitle } from './step-title';

export function ChannelStep({
  shopId,
  channelTitle,
}: {
  shopId: string;
  channelTitle: string | null;
}) {
  const [channel, setChannel] = useState('');
  const [error, setError] = useState<string>();
  const connect = useConnectChannel(shopId);
  const { t } = useT();

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    const input = connectChannelSchema.safeParse({ channel });
    setError(input.success ? undefined : fieldErrors(input.error).channel);
    if (input.success) connect.mutate(input.data);
  };

  return (
    <Card>
      <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
        <StepTitle title={t('setup.channel')} done={channelTitle !== null} />
        {channelTitle && (
          <p className="text-sm">{t('setup.connectedTo', { title: channelTitle })}</p>
        )}
        <p className="text-sm text-muted-foreground">{t('setup.channelHint')}</p>
        <Field
          label={t('setup.channelField')}
          placeholder="@selamshoes"
          value={channel}
          onChange={(e) => {
            setChannel(e.target.value);
          }}
          error={error}
          autoCapitalize="none"
        />
        {connect.isError && <Alert tone="error">{connect.error.message}</Alert>}
        {connect.isSuccess && (
          <Alert tone="info">{t('setup.connectedTo', { title: connect.data.title })}</Alert>
        )}
        <Button type="submit" disabled={connect.isPending}>
          {connect.isPending ? t('setup.checkingRights') : t('setup.connect')}
        </Button>
      </form>
    </Card>
  );
}
