import type { Coordinates } from '@buchi/shared';
import { telegramWebApp } from './telegram';

export class LocationUnavailableError extends Error {
  constructor() {
    super('Location access is off. Allow it and try again.');
    this.name = 'LocationUnavailableError';
  }
}

/**
 * The device's location. Inside Telegram it uses the Mini App LocationManager, which asks for
 * access in Telegram's own words; elsewhere, or on older Telegram apps, the browser's geolocation.
 */
export function currentLocation(): Promise<Coordinates> {
  const manager = telegramWebApp()?.LocationManager;
  if (!manager) return browserLocation();
  return new Promise((resolve, reject) => {
    const read = () => {
      if (!manager.isLocationAvailable) {
        resolve(browserLocation());
        return;
      }
      manager.getLocation((location) => {
        if (location) resolve({ latitude: location.latitude, longitude: location.longitude });
        else reject(new LocationUnavailableError());
      });
    };
    if (manager.isInited) read();
    else manager.init(read);
  });
}

function browserLocation(): Promise<Coordinates> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new LocationUnavailableError());
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        resolve({ latitude: coords.latitude, longitude: coords.longitude });
      },
      () => {
        reject(new LocationUnavailableError());
      },
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  });
}
