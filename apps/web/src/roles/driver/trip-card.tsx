import { formatBirr, type Trip, type TripStop } from '@buchi/shared';
import { useMemo, useState } from 'react';
import { LazyStopsMap } from '../../components/map/lazy-maps';
import type { MapStop } from '../../components/map/stops-map';
import { Alert } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { currentLocation } from '../../lib/location';
import { useDelivered, usePickedUp } from './driver-api';

export function TripCard({ trip }: { trip: Trip }) {
  const pickedUp = usePickedUp();
  const stops = useMemo<MapStop[]>(
    () => [
      ...(trip.shopPin ? [{ label: 'S', point: trip.shopPin }] : []),
      ...trip.stops.map((stop) => ({ label: String(stop.position), point: stop.pin })),
    ],
    [trip],
  );
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium">{trip.shopName}</p>
        <p className="font-semibold">{formatBirr(trip.payout)}</p>
      </div>
      <LazyStopsMap stops={stops} />
      <ol className="flex flex-col gap-2">
        {trip.stops.map((stop) => (
          <StopRow key={stop.stopId} stop={stop} onTheWay={trip.status === 'picked_up'} />
        ))}
      </ol>
      {pickedUp.isError && <Alert tone="error">{pickedUp.error.message}</Alert>}
      {trip.status === 'assigned' && (
        <Button
          disabled={pickedUp.isPending}
          onClick={() => {
            pickedUp.mutate(trip.jobId);
          }}
        >
          Picked up · ተቀብያለሁ
        </Button>
      )}
    </Card>
  );
}

function StopRow({ stop, onTheWay }: { stop: TripStop; onTheWay: boolean }) {
  const delivered = useDelivered();
  const [locationError, setLocationError] = useState<string>();
  const directions = `https://www.google.com/maps/dir/?api=1&destination=${String(stop.pin.latitude)},${String(stop.pin.longitude)}`;

  const deliver = () => {
    setLocationError(undefined);
    currentLocation().then(
      (location) => {
        delivered.mutate({ stopId: stop.stopId, location });
      },
      (err: unknown) => {
        setLocationError(err instanceof Error ? err.message : 'No location.');
      },
    );
  };

  return (
    <li className="flex flex-col gap-2 rounded-lg bg-muted p-3">
      <p className="text-sm font-medium">
        {stop.position}. {stop.customerName}
        {stop.delivered && ' · delivered ✓'}
      </p>
      <div className="flex flex-wrap gap-3 text-sm">
        {stop.phone && (
          <a className="text-link underline" href={`tel:${stop.phone}`}>
            Call {stop.phone}
          </a>
        )}
        <a className="text-link underline" href={directions} target="_blank" rel="noreferrer">
          Directions
        </a>
      </div>
      {locationError && <Alert tone="error">{locationError}</Alert>}
      {delivered.isError && <Alert tone="error">{delivered.error.message}</Alert>}
      {onTheWay && !stop.delivered && (
        <Button disabled={delivered.isPending} onClick={deliver}>
          {delivered.isPending ? 'Checking your location…' : 'Delivered · ደርሷል'}
        </Button>
      )}
    </li>
  );
}
