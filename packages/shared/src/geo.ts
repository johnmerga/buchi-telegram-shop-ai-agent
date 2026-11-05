import { z } from 'zod';

export const coordinatesSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});
export type Coordinates = z.infer<typeof coordinatesSchema>;

/** A place-name search on the map pickers, for when the device's location is far off. */
export const placeQuerySchema = z.object({ q: z.string().trim().min(2).max(100) });

export const placeSchema = coordinatesSchema.extend({ name: z.string() });
export type Place = z.infer<typeof placeSchema>;
