import { formatBirr, type OpenOffer } from '@buchi/shared';
import type { ReactNode } from 'react';
import { Alert } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
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
  return (
    <OfferDetails offer={offer}>
      <Alert tone="info">
        You hold this job. It is yours once the customer pays · ደንበኛው ሲከፍል ስራው የእርስዎ ነው።
      </Alert>
    </OfferDetails>
  );
}

function OfferDetails({ offer, children }: { offer: OpenOffer; children: ReactNode }) {
  return (
    <Card className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium">{offer.shopName}</p>
        {offer.raised && <Badge tone="primary">{offer.far ? 'Price raised' : 'Bonus'}</Badge>}
      </div>
      <p className="text-sm">
        <span className="text-lg font-semibold">{formatBirr(offer.price)}</span> ·{' '}
        {offer.stops === 1 ? '1 stop' : `${String(offer.stops)} stops`} ·{' '}
        {(offer.routeMeters / 1000).toFixed(1)} km · about {offer.estimatedMinutes} min
      </p>
      <p className="text-xs text-muted-foreground">
        You see the customer’s name, phone, and pin after you get the job.
      </p>
      {children}
    </Card>
  );
}

function AcceptButton({ offerId }: { offerId: string }) {
  const accept = useAccept();
  return (
    <>
      {accept.data?.result === 'closed' && (
        <Alert tone="info">Another driver took this job first.</Alert>
      )}
      {accept.isError && <Alert tone="error">{accept.error.message}</Alert>}
      <Button
        disabled={accept.isPending}
        onClick={() => {
          accept.mutate(offerId);
        }}
      >
        {accept.isPending ? 'Accepting…' : 'Accept · እቀበላለሁ'}
      </Button>
    </>
  );
}

function HoldButton({ offerId }: { offerId: string }) {
  const hold = useHold();
  return (
    <>
      {hold.data?.result === 'closed' && <Alert tone="info">Another driver holds this job.</Alert>}
      {hold.isError && <Alert tone="error">{hold.error.message}</Alert>}
      <Button
        disabled={hold.isPending}
        onClick={() => {
          hold.mutate(offerId);
        }}
      >
        {hold.isPending ? 'Holding…' : 'Hold this price · ዋጋውን ያዙ'}
      </Button>
    </>
  );
}
