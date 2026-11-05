import type { Coordinates } from '@buchi/shared';
import { telegramWebApp } from './telegram';

export class LocationUnavailableError extends Error {
  constructor() {
    super('Location access is off. Allow it and try again.');
    this.name = 'LocationUnavailableError';
  }
}

/** Worse than this, the pin can be in the wrong neighborhood or the wrong town. */
const APPROXIMATE_METERS = 1000;

/** `accuracyMeters` is undefined when the device does not report it. */
export interface DeviceLocation {
  coordinates: Coordinates;
  accuracyMeters: number | undefined;
}

/**
 * The device's location. Inside Telegram it uses the Mini App LocationManager, which asks for
 * access in Telegram's own words; elsewhere, or on older Telegram apps, the browser's geolocation.
 */
export function currentLocation(): Promise<DeviceLocation> {
  const manager = telegramWebApp()?.LocationManager;
  if (!manager) return browserLocation();
  return new Promise((resolve, reject) => {
    const read = () => {
      if (!manager.isLocationAvailable) {
        resolve(browserLocation());
        return;
      }
      manager.getLocation((location) => {
        if (location) {
          const { latitude, longitude, horizontal_accuracy } = location;
          resolve({
            coordinates: { latitude, longitude },
            accuracyMeters: horizontal_accuracy ?? undefined,
          });
        } else reject(new LocationUnavailableError());
      });
    };
    if (manager.isInited) read();
    else manager.init(read);
  });
}

function browserLocation(): Promise<DeviceLocation> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new LocationUnavailableError());
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        resolve({
          coordinates: { latitude: coords.latitude, longitude: coords.longitude },
          accuracyMeters: coords.accuracy,
        });
      },
      () => {
        reject(new LocationUnavailableError());
      },
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  });
}

/**
 * How far off a location too rough to trust can be, in whole kilometers, such as Telegram
 * Desktop's, which comes from the internet address and can be a town away.
 */
export function approximateKm({ accuracyMeters }: DeviceLocation): number | undefined {
  if (accuracyMeters === undefined || accuracyMeters <= APPROXIMATE_METERS) return undefined;
  return Math.round(accuracyMeters / 1000);
}
