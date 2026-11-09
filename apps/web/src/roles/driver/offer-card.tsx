import { formatBirr, type OpenOffer } from '@buchi/shared';
import type { ReactNode } from 'react';
import { Alert } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { useT } from '../../lib/i18n';
import { useAccept, useHold } from './driver-api';

/** An open job. A far-area job is held, not accepted: it becomes the driver's once paid. */
export function OfferCard({ offer }: { offer: OpenOffer }) {
  return (
    <OfferDetails offer={offer}>
      {offer.far ? (
        <HoldButton offerId={offer.offerId} />
      ) : (
        <AcceptButton offerId={offer.offerId} />
      )}
    </OfferDetails>
  );
}

/** A far-area job the driver holds while the customer decides and pays. */
export function HeldOfferCard({ offer }: { offer: OpenOffer }) {
  const { t } = useT();
  return (
    <OfferDetails offer={offer}>
      <Alert tone="info">{t('driver.youHold')}</Alert>
    </OfferDetails>
  );
}

function OfferDetails({ offer, children }: { offer: OpenOffer; children: ReactNode }) {
  const { t } = useT();
  return (
    <Card className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium">{offer.shopName}</p>
        {offer.raised && (
          <Badge tone="primary">{offer.far ? t('driver.raised') : t('driver.bonus')}</Badge>
        )}
      </div>
      <p className="text-sm">
        <span className="text-lg font-semibold">{formatBirr(offer.price)}</span> ·{' '}
        {offer.stops === 1
          ? t('deliveries.oneStop')
          : t('deliveries.stops', { count: offer.stops })}{' '}
        ·{' '}
        {t('driver.route', {
          km: (offer.routeMeters / 1000).toFixed(1),
          minutes: offer.estimatedMinutes,
        })}
      </p>
      <p className="text-xs text-muted-foreground">{t('driver.detailsAfter')}</p>
      {children}
    </Card>
  );
}

function AcceptButton({ offerId }: { offerId: string }) {
  const accept = useAccept();
  const { t } = useT();
  return (
    <>
      {accept.data?.result === 'closed' && <Alert tone="info">{t('driver.taken')}</Alert>}
      {accept.isError && <Alert tone="error">{accept.error.message}</Alert>}
      <Button
        disabled={accept.isPending}
        onClick={() => {
          accept.mutate(offerId);
        }}
      >
        {accept.isPending ? t('driver.accepting') : t('driver.accept')}
      </Button>
    </>
  );
}

function HoldButton({ offerId }: { offerId: string }) {
  const hold = useHold();
  const { t } = useT();
  return (
    <>
      {hold.data?.result === 'closed' && <Alert tone="info">{t('driver.heldByOther')}</Alert>}
      {hold.isError && <Alert tone="error">{hold.error.message}</Alert>}
      <Button
        disabled={hold.isPending}
        onClick={() => {
          hold.mutate(offerId);
        }}
      >
        {hold.isPending ? t('driver.holding') : t('driver.hold')}
      </Button>
    </>
  );
}
