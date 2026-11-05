import { z } from 'zod';
import type { Coordinates } from '../modules/delivery/location.domain';
import type { RoadRouter, TravelMatrix } from '../modules/delivery/route.service';

/** Motorbikes are not an OpenRouteService profile. Cars use the same city roads. */
const DIRECTIONS_PATH = '/openrouteservice/v2/directions/driving-car';
const MATRIX_PATH = '/openrouteservice/v2/matrix/driving-car';
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

/** A point that no road reaches comes back as `null`, which fails the parse. */
const matrixSchema = z.object({
  distances: z.array(z.array(z.number().nonnegative())),
  durations: z.array(z.array(z.number().nonnegative())),
});

/** OpenRouteService directions and matrices on HeiGIT's API, authenticated with the raw key. */
export class OpenRouteService implements RoadRouter {
  constructor(
    private readonly config: { baseUrl: string; apiKey: string },
    private readonly fetch: typeof globalThis.fetch,
  ) {}

  async route(from: Coordinates, to: Coordinates): Promise<{ meters: number; seconds: number }> {
    const body = await this.post(DIRECTIONS_PATH, {
      coordinates: [lngLat(from), lngLat(to)],
      instructions: false,
      geometry: false,
    });
    const [route] = directionsSchema.parse(body).routes;
    if (!route) throw new Error('OpenRouteService returned no route');
    return {
      meters: Math.round(route.summary.distance),
      seconds: Math.round(route.summary.duration),
    };
  }

  /** Road distances and durations between every pair of points, in both directions. */
  async matrix(points: Coordinates[]): Promise<TravelMatrix> {
    const body = await this.post(MATRIX_PATH, {
      locations: points.map(lngLat),
      metrics: ['distance', 'duration'],
    });
    const { distances, durations } = matrixSchema.parse(body);
    const square = (rows: number[][]) =>
      rows.length === points.length && rows.every((row) => row.length === points.length);
    if (!square(distances) || !square(durations)) {
      throw new Error('OpenRouteService returned a matrix of the wrong size');
    }
    const rounded = (rows: number[][]) => rows.map((row) => row.map((value) => Math.round(value)));
    return { meters: rounded(distances), seconds: rounded(durations) };
  }

  private async post(path: string, body: unknown): Promise<unknown> {
    const response = await this.fetch(new URL(path, this.config.baseUrl), {
      method: 'POST',
      headers: {
        authorization: this.config.apiKey,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`OpenRouteService answered ${String(response.status)}`);
    return response.json();
  }
}

/** OpenRouteService takes [longitude, latitude]. */
function lngLat(point: Coordinates): [number, number] {
  return [point.longitude, point.latitude];
}
