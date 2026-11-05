import { z } from 'zod';
import type { Coordinates } from '../modules/delivery/location.domain';
import type { RoadRouter } from '../modules/delivery/route.service';

/** Motorbikes are not an OpenRouteService profile. Cars use the same city roads. */
const DIRECTIONS_PATH = '/openrouteservice/v2/directions/driving-car';
const TIMEOUT_MS = 5000;

/** OpenRouteService leaves out a zero distance or duration, for example for a trip of 0 m. */
const directionsSchema = z.object({
  routes: z.array(
    z.object({
      summary: z.object({
        distance: z.number().nonnegative().default(0),
        duration: z.number().nonnegative().default(0),
      }),
    }),
  ),
});

/** OpenRouteService directions on HeiGIT's API, authenticated with the raw key. */
export class OpenRouteService implements RoadRouter {
  constructor(
    private readonly config: { baseUrl: string; apiKey: string },
    private readonly fetch: typeof globalThis.fetch,
  ) {}

  async route(from: Coordinates, to: Coordinates): Promise<{ meters: number; seconds: number }> {
    const response = await this.fetch(new URL(DIRECTIONS_PATH, this.config.baseUrl), {
      method: 'POST',
      headers: {
        authorization: this.config.apiKey,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        // OpenRouteService takes [longitude, latitude].
        coordinates: [
          [from.longitude, from.latitude],
          [to.longitude, to.latitude],
        ],
        instructions: false,
        geometry: false,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`OpenRouteService answered ${String(response.status)}`);
    const [route] = directionsSchema.parse(await response.json()).routes;
    if (!route) throw new Error('OpenRouteService returned no route');
    return {
      meters: Math.round(route.summary.distance),
      seconds: Math.round(route.summary.duration),
    };
  }
}
