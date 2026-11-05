import { connectChannelSchema } from '@buchi/shared';
import { useState, type SubmitEvent } from 'react';
import { Alert } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Field } from '../../components/ui/field';
import { fieldErrors } from '../../lib/form';
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

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    const input = connectChannelSchema.safeParse({ channel });
    setError(input.success ? undefined : fieldErrors(input.error).channel);
    if (input.success) connect.mutate(input.data);
  };

  return (
    <Card>
      <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
        <StepTitle title="1. Channel · ቻናል" done={channelTitle !== null} />
        {channelTitle && <p className="text-sm">Connected to {channelTitle}.</p>}
        <p className="text-sm text-muted-foreground">
          Add the Buchi bot to your channel as an admin that can post messages, then enter the
          channel here.
        </p>
        <Field
          label="Channel"
          placeholder="@selamshoes"
          value={channel}
          onChange={(e) => {
            setChannel(e.target.value);
          }}
          error={error}
          autoCapitalize="none"
        />
        {connect.isError && <Alert tone="error">{connect.error.message}</Alert>}
        {connect.isSuccess && <Alert tone="info">Connected to {connect.data.title}.</Alert>}
        <Button type="submit" disabled={connect.isPending}>
          {connect.isPending ? 'Checking the bot’s rights…' : 'Connect channel'}
        </Button>
      </form>
    </Card>
  );
}
