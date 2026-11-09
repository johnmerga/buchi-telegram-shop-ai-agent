import { driverInviteSchema, type DriverListItem, type DriverWork } from '@buchi/shared';
import { useState, type SubmitEvent } from 'react';
import { QueryView } from '../../components/query-view';
import { EmptyState } from '../../components/screen-state';
import { Alert } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardTitle } from '../../components/ui/card';
import { Field } from '../../components/ui/field';
import { fieldErrors } from '../../lib/form';
import { DriverIcon } from '../../components/icons';
import { useT, type MessageKey, type Translate } from '../../lib/i18n';
import { telegramWebApp } from '../../lib/telegram';
import { useDrivers, useInviteDriver } from './owner-api';
import { useShopId } from './use-shop-id';

export default function DriversScreen() {
  const shopId = useShopId();
  const drivers = useDrivers(shopId);
  const { t } = useT();
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{t('nav.drivers')}</h2>
      <InviteForm shopId={shopId} />
      <p className="text-xs text-muted-foreground">{t('drivers.dutyHint')}</p>
      <QueryView query={drivers}>
        {(list) =>
          list.length === 0 ? (
            <EmptyState title={t('drivers.empty')} icon={<DriverIcon />}>
              {t('drivers.emptyHint')}
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

const stages: Record<DriverWork['stage'], MessageKey> = {
  to_pickup: 'drivers.toPickup',
  delivering: 'drivers.delivering',
};

/** What a linked driver is doing now, or that they are free for a job. */
function workLabel(work: DriverWork | null, t: Translate): string {
  return work === null ? t('drivers.free') : t(stages[work.stage], { order: work.orderReference });
}

function DriverRow({ driver }: { driver: DriverListItem }) {
  const { t, formatTime } = useT();
  return (
    <li className="flex items-center justify-between gap-2 rounded-xl border border-border bg-card p-3">
      <div>
        <p className="font-medium">{driver.name ?? `@${driver.username}`}</p>
        <p className="text-xs text-muted-foreground">
          @{driver.username}
          {!driver.linked &&
            driver.inviteExpiresAt &&
            ` · ${t('drivers.inviteUntil', { time: formatTime(driver.inviteExpiresAt) })}`}
        </p>
        {driver.linked && <p className="text-sm">{workLabel(driver.work, t)}</p>}
      </div>
      {driver.linked ? (
        <Badge tone={driver.available ? 'primary' : 'neutral'}>
          {driver.available ? t('drivers.onDuty') : t('drivers.offDuty')}
        </Badge>
      ) : (
        <Badge>{t('drivers.invited')}</Badge>
      )}
    </li>
  );
}

function InviteForm({ shopId }: { shopId: string }) {
  const [username, setUsername] = useState('');
  const [error, setError] = useState<string>();
  const invite = useInviteDriver(shopId);
  const { t } = useT();

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
        <CardTitle>{t('drivers.invite')}</CardTitle>
        <p className="text-sm text-muted-foreground">{t('drivers.inviteHint')}</p>
        <Field
          label={t('drivers.username')}
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
          {t('drivers.createLink')}
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
  const { t, formatTime } = useT();
  const webApp = telegramWebApp();
  const share = () => {
    const url = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(t('drivers.shareText'))}`;
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
      <p className="text-xs text-muted-foreground">
        {t('drivers.worksOnce', { time: formatTime(expiresAt) })}
      </p>
      <div className="flex gap-2">
        <Button className="flex-1" onClick={share}>
          {t('drivers.send')}
        </Button>
        <Button variant="outline" className="flex-1" onClick={copy}>
          {copied ? t('drivers.copied') : t('drivers.copy')}
        </Button>
      </div>
    </div>
  );
}
