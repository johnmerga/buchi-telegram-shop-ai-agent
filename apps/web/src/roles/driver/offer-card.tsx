import { formatBirr, type OpenOffer } from '@buchi/shared';
import { Alert } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { useAccept } from './driver-api';

export function OfferCard({ offer }: { offer: OpenOffer }) {
  const accept = useAccept();
  return (
    <Card className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium">{offer.shopName}</p>
        {offer.special && <Badge tone="primary">Bonus</Badge>}
      </div>
      <p className="text-sm">
        <span className="text-lg font-semibold">{formatBirr(offer.price)}</span> ·{' '}
        {offer.stops === 1 ? '1 stop' : `${String(offer.stops)} stops`} ·{' '}
        {(offer.routeMeters / 1000).toFixed(1)} km · about {offer.estimatedMinutes} min
      </p>
      <p className="text-xs text-muted-foreground">
        You see the customer’s name, phone, and pin after you accept.
      </p>
      {accept.data?.result === 'closed' && (
        <Alert tone="info">Another driver took this job first.</Alert>
      )}
      {accept.isError && <Alert tone="error">{accept.error.message}</Alert>}
      <Button
        disabled={accept.isPending}
        onClick={() => {
          accept.mutate(offer.offerId);
        }}
      >
        {accept.isPending ? 'Accepting…' : 'Accept · እቀበላለሁ'}
      </Button>
    </Card>
  );
}
