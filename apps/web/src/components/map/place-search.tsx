import { placeQuerySchema, placeSchema, type Coordinates } from '@buchi/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { z } from 'zod';
import { useApi } from '../api-context';
import { Alert } from '../ui/alert';
import { Button } from '../ui/button';
import { Input } from '../ui/input';

/**
 * Finds a town or area by name and moves the pin there. It searches on submit only, because the
 * server shares Nominatim's one request a second with every other user.
 */
export function PlaceSearch({ onChoose }: { onChoose: (point: Coordinates) => void }) {
  const api = useApi();
  const [text, setText] = useState('');
  const [query, setQuery] = useState<string>();
  const places = useQuery({
    queryKey: ['places', query],
    queryFn: () =>
      api.get(
        `/places?${new URLSearchParams({ q: query ?? '' }).toString()}`,
        z.array(placeSchema),
      ),
    enabled: query !== undefined,
  });
  const valid = placeQuerySchema.safeParse({ q: text });

  return (
    <div className="flex flex-col gap-2">
      <form
        role="search"
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid.success) setQuery(valid.data.q);
        }}
      >
        <Input
          aria-label="Search for a place"
          placeholder="Town or area, e.g. Adama · ቦታ ይፈልጉ"
          value={text}
          maxLength={100}
          onChange={(event) => {
            setText(event.target.value);
          }}
        />
        <Button type="submit" variant="outline" disabled={!valid.success}>
          Search
        </Button>
      </form>
      {places.isFetching && <p className="text-sm text-muted-foreground">Searching…</p>}
      {places.isError && <Alert tone="error">{places.error.message}</Alert>}
      {places.data?.length === 0 && <Alert tone="info">No places found.</Alert>}
      {places.data && places.data.length > 0 && (
        <ul className="flex flex-col gap-1" aria-label="Places found">
          {places.data.map((place) => (
            <li key={`${String(place.latitude)},${String(place.longitude)}`}>
              <Button
                variant="ghost"
                className="w-full justify-start text-left"
                onClick={() => {
                  onChoose({ latitude: place.latitude, longitude: place.longitude });
                  setQuery(undefined);
                }}
              >
                {place.name}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
