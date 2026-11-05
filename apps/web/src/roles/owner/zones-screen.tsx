import type { ZoneFactor, ZoneMap } from '@buchi/shared';
import { useMemo, useState } from 'react';
import { LazyHexMap } from '../../components/map/lazy-maps';
import type { MapHexagon } from '../../components/map/hex-map';
import { QueryView } from '../../components/query-view';
import { EmptyState } from '../../components/screen-state';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { useZones } from './dashboard-api';
import { useShopId } from './use-shop-id';

type Band = 'peak' | 'offPeak';

const bandLabels: Record<Band, string> = { peak: 'Rush hour', offPeak: 'Other times' };
/** The table lists the slowest zones; the map shows them all. */
const LISTED_ZONES = 10;

/** The learned time factors: how much longer than the map's estimate trips to each zone take. */
export default function ZonesScreen() {
  const shopId = useShopId();
  const zones = useZones(shopId);
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Zones · ዞኖች</h2>
      <QueryView query={zones}>{(map) => <Zones map={map} />}</QueryView>
    </div>
  );
}

function Zones({ map }: { map: ZoneMap }) {
  const [band, setBand] = useState<Band>('peak');
  const inBand = useMemo(
    () =>
      map.zones
        .flatMap((zone) => {
          const learned = zone[band];
          return learned ? [{ zone, ...learned }] : [];
        })
        .sort((a, b) => b.factor - a.factor),
    [map, band],
  );
  const hexagons = useMemo(() => shaded(inBand), [inBand]);

  return (
    <>
      <div className="flex gap-2" role="group" aria-label="Time of day">
        {(['peak', 'offPeak'] as const).map((option) => (
          <Button
            key={option}
            size="sm"
            variant={band === option ? 'default' : 'outline'}
            aria-pressed={band === option}
            onClick={() => {
              setBand(option);
            }}
          >
            {bandLabels[option]}
          </Button>
        ))}
      </div>
      {inBand.length === 0 ? (
        <EmptyState title="No zones learned yet · ገና አልተማረም">
          Each delivered trip teaches Buchi how long trips to its area take. The nightly job updates
          this map.
        </EmptyState>
      ) : (
        <>
          <LazyHexMap hexagons={hexagons} />
          <p className="text-xs text-muted-foreground">
            Darker zones take longer than the map’s estimate. Tap a zone for its factor and trips.
          </p>
        </>
      )}
      <Card className="text-sm">
        {map.estimateError ? (
          <p>
            Trip-time estimates of the last 14 days were off by{' '}
            <span className="font-semibold">{map.estimateError.errorPercent}%</span> on average,
            over {map.estimateError.trips} trips.
          </p>
        ) : (
          <p className="text-muted-foreground">No real trips in the last 14 days to measure yet.</p>
        )}
      </Card>
      {inBand.length > 0 && (
        <table className="w-full text-left text-sm">
          <caption className="mb-2 text-left font-medium">Slowest zones</caption>
          <thead className="text-muted-foreground">
            <tr>
              <th className="font-normal">Zone</th>
              <th className="font-normal">Factor</th>
              <th className="font-normal">Trips</th>
            </tr>
          </thead>
          <tbody>
            {inBand.slice(0, LISTED_ZONES).map(({ zone, factor, trips }) => (
              <tr key={zone.zone}>
                <td className="font-mono text-xs">{zone.zone}</td>
                <td>×{factor.toFixed(2)}</td>
                <td>{trips}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function shaded(zones: { zone: ZoneFactor; factor: number; trips: number }[]): MapHexagon[] {
  const factors = zones.map((zone) => zone.factor);
  const low = Math.min(...factors);
  const range = Math.max(...factors) - low;
  return zones.map(({ zone, factor, trips }) => ({
    id: zone.zone,
    corners: zone.boundary,
    shade: range === 0 ? 1 : (factor - low) / range,
    label: `×${factor.toFixed(2)} · ${String(trips)} trips`,
  }));
}
