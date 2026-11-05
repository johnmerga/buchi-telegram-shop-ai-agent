import type { Coordinates, Shop } from '@buchi/shared';
import { useState } from 'react';
import { ADDIS_ABABA } from '../../components/map/default-center';
import { LazyPinPickerMap } from '../../components/map/lazy-maps';
import { PlaceSearch } from '../../components/map/place-search';
import { Alert } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { approximateKm, currentLocation } from '../../lib/location';
import { useSetLocation } from './owner-api';
import { StepTitle } from './step-title';

export function LocationStep({ shopId, shop }: { shopId: string; shop: Shop }) {
  const saved =
    shop.latitude === null || shop.longitude === null
      ? undefined
      : { latitude: shop.latitude, longitude: shop.longitude };
  const [pin, setPin] = useState<Coordinates>(saved ?? ADDIS_ABABA);
  const [locating, setLocating] = useState<string>();
  const save = useSetLocation(shopId);

  const useMine = () => {
    setLocating('Finding your location…');
    currentLocation().then(
      (location) => {
        setPin(location.coordinates);
        setLocating(approximateNotice(approximateKm(location)));
      },
      (err: unknown) => {
        setLocating(err instanceof Error ? err.message : 'Location is not available.');
      },
    );
  };

  return (
    <Card className="flex flex-col gap-3">
      <StepTitle title="2. Shop location · የሱቅ ቦታ" done={saved !== undefined} />
      <p className="text-sm text-muted-foreground">
        Drag the pin to your shop’s door. Drivers start here, and delivery prices count from here.
      </p>
      <PlaceSearch onChoose={setPin} />
      <LazyPinPickerMap value={pin} onChange={setPin} />
      <p className="text-xs text-muted-foreground">
        {pin.latitude.toFixed(5)}, {pin.longitude.toFixed(5)}
      </p>
      {locating && <Alert tone="info">{locating}</Alert>}
      {save.isError && <Alert tone="error">{save.error.message}</Alert>}
      {save.isSuccess && <Alert tone="info">Location saved.</Alert>}
      <div className="flex gap-2">
        <Button variant="outline" className="flex-1" onClick={useMine}>
          Use my location
        </Button>
        <Button
          className="flex-1"
          disabled={save.isPending}
          onClick={() => {
            save.mutate(pin);
          }}
        >
          Save location
        </Button>
      </div>
    </Card>
  );
}

function approximateNotice(km: number | undefined): string | undefined {
  return km === undefined
    ? undefined
    : `This location is approximate (about ${String(km)} km). Search your area or drag the pin.`;
}
