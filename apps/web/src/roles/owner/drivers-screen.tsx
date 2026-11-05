import { driverInviteSchema, type DriverListItem } from '@buchi/shared';
import { useState, type SubmitEvent } from 'react';
import { QueryView } from '../../components/query-view';
import { EmptyState } from '../../components/screen-state';
import { Alert } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardTitle } from '../../components/ui/card';
import { Field } from '../../components/ui/field';
import { fieldErrors } from '../../lib/form';
import { formatTime } from '../../lib/labels';
import { telegramWebApp } from '../../lib/telegram';
import { useDrivers, useInviteDriver } from './owner-api';
import { useShopId } from './use-shop-id';

export default function DriversScreen() {
  const shopId = useShopId();
  const drivers = useDrivers(shopId);
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Drivers · ሹፌሮች</h2>
      <InviteForm shopId={shopId} />
      <QueryView query={drivers}>
        {(list) =>
          list.length === 0 ? (
            <EmptyState title="No drivers yet · ገና ሹፌር የለም">
              Invite a driver by their Telegram username.
            </EmptyState>
          ) : (
            <ul className="flex flex-col gap-2">
              {list.map((driver) => (
                <DriverRow key={driver.id} driver={driver} />
              ))}
            </ul>
          )
        }
      </QueryView>
    </div>
  );
}

function DriverRow({ driver }: { driver: DriverListItem }) {
  return (
    <li className="flex items-center justify-between gap-2 rounded-xl border border-border bg-card p-3">
      <div>
        <p className="font-medium">{driver.name ?? `@${driver.username}`}</p>
        <p className="text-xs text-muted-foreground">
          @{driver.username}
          {!driver.linked &&
            driver.inviteExpiresAt &&
            ` · invite valid until ${formatTime(driver.inviteExpiresAt)}`}
        </p>
      </div>
      {driver.linked ? (
        <Badge tone={driver.available ? 'primary' : 'neutral'}>
          {driver.available ? 'On duty' : 'Off duty'}
        </Badge>
      ) : (
        <Badge>Invited</Badge>
      )}
    </li>
  );
}

function InviteForm({ shopId }: { shopId: string }) {
  const [username, setUsername] = useState('');
  const [error, setError] = useState<string>();
  const invite = useInviteDriver(shopId);

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    const input = driverInviteSchema.safeParse({ username });
    setError(input.success ? undefined : fieldErrors(input.error).username);
    if (input.success)
      invite.mutate(input.data, {
        onSuccess: () => {
          setUsername('');
        },
      });
  };

  return (
    <Card>
      <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
        <CardTitle>Invite a driver</CardTitle>
        <p className="text-sm text-muted-foreground">
          Telegram does not let a bot message someone first, so you send the driver a one-time link.
        </p>
        <Field
          label="Driver’s Telegram username"
          placeholder="@abebe_rides"
          value={username}
          onChange={(e) => {
            setUsername(e.target.value);
          }}
          error={error}
          autoCapitalize="none"
        />
        {invite.isError && <Alert tone="error">{invite.error.message}</Alert>}
        <Button type="submit" disabled={invite.isPending}>
          Create invite link
        </Button>
        {invite.isSuccess && (
          <InviteLink link={invite.data.link} expiresAt={invite.data.expiresAt} />
        )}
      </form>
    </Card>
  );
}

function InviteLink({ link, expiresAt }: { link: string; expiresAt: string }) {
  const [copied, setCopied] = useState(false);
  const webApp = telegramWebApp();
  const share = () => {
    const url = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent('Join my shop on Buchi as a driver')}`;
    if (webApp) webApp.openTelegramLink(url);
    else window.open(url, '_blank', 'noopener');
  };
  const copy = () => {
    void navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
    });
  };
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-muted p-3">
      <p className="text-xs break-all">{link}</p>
      <p className="text-xs text-muted-foreground">It works once, until {formatTime(expiresAt)}.</p>
      <div className="flex gap-2">
        <Button className="flex-1" onClick={share}>
          Send in Telegram
        </Button>
        <Button variant="outline" className="flex-1" onClick={copy}>
          {copied ? 'Copied' : 'Copy link'}
        </Button>
      </div>
    </div>
  );
}
