import { coordinatesSchema, type Coordinates } from '@buchi/shared';
import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router';
import { ADDIS_ABABA } from '../../components/map/default-center';
import { LazyPinPickerMap } from '../../components/map/lazy-maps';
import { MainAction } from '../../components/telegram-buttons';
import { Alert } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { approximateKm, currentLocation } from '../../lib/location';
import { telegramWebApp } from '../../lib/telegram';

/** The suggested pin from the link, such as a landmark the customer named in the chat. */
function suggestedPin(params: URLSearchParams): Coordinates | undefined {
  const pin = coordinatesSchema.safeParse({
    latitude: Number(params.get('lat')),
    longitude: Number(params.get('lng')),
  });
  return params.has('lat') && pin.success ? pin.data : undefined;
}

/**
 * The delivery pin picker. The customer drags the pin to where the order goes, which can differ
 * from where they are, and the pin goes back to the chat, where the purchase flow continues.
 */
export default function PinPickerScreen() {
  const [params] = useSearchParams();
  const suggested = suggestedPin(params);
  const [pin, setPin] = useState<Coordinates>(suggested ?? ADDIS_ABABA);
  const [notice, setNotice] = useState<string>();
  const webApp = telegramWebApp();

  const useMine = () => {
    setNotice('Finding your location…');
    currentLocation().then(
      (location) => {
        setPin(location.coordinates);
        setNotice(approximateNotice(approximateKm(location)));
      },
      (err: unknown) => {
        setNotice(err instanceof Error ? err.message : 'Location is not available.');
      },
    );
  };

  const send = useCallback(() => {
    // sendData closes the Mini App; Telegram delivers the pin to the bot as a service message.
    webApp?.sendData(JSON.stringify(pin));
  }, [webApp, pin]);

  return (
    <>
      <h1 className="text-xl font-semibold">Where should we deliver? · የት እናድርስ?</h1>
      <p className="text-sm text-muted-foreground">
        Drag the pin, or tap the map, where the order should arrive.
        {suggested && ' It starts at the place you named.'}
      </p>
      <LazyPinPickerMap value={pin} onChange={setPin} />
      {notice && <Alert tone="info">{notice}</Alert>}
      <Button variant="outline" onClick={useMine}>
        📍 Use my location · አሁን ያለሁበት
      </Button>
      {webApp ? (
        <MainAction text="Deliver here · እዚህ ያድርሱ" onClick={send} />
      ) : (
        <Alert tone="info">Open the map from the chat’s “Pick on the map” button to send it.</Alert>
      )}
    </>
  );
}

function approximateNotice(km: number | undefined): string | undefined {
  return km === undefined
    ? undefined
    : `This location is approximate (about ${String(km)} km). Drag the pin to where the order should arrive.`;
}
