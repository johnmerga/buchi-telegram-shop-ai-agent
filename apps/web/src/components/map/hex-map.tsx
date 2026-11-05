import type { Coordinates } from '@buchi/shared';
import L from 'leaflet';
import { useEffect, useRef } from 'react';
import { ADDIS_ABABA } from './default-center';
import { tileLayer } from './leaflet-setup';

/** A hexagon to shade: `shade` runs from 0 (lightest) to 1 (darkest). */
export interface MapHexagon {
  id: string;
  corners: Coordinates[];
  shade: number;
  label: string;
}

const CITY_ZOOM = 11;
const MIN_OPACITY = 0.1;
const MAX_OPACITY = 0.7;

/** A read-only map of shaded hexagons, one hue from light to dark. Tapping one shows its label. */
export default function HexMap({ hexagons }: { hexagons: MapHexagon[] }) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!container.current) return;
    const map = L.map(container.current);
    tileLayer().addTo(map);
    const layers = hexagons.map((hexagon) =>
      L.polygon(
        hexagon.corners.map((corner) => L.latLng(corner.latitude, corner.longitude)),
        {
          className: 'map-zone',
          weight: 1,
          fillOpacity: MIN_OPACITY + hexagon.shade * (MAX_OPACITY - MIN_OPACITY),
        },
      )
        .bindTooltip(hexagon.label)
        .addTo(map),
    );
    if (layers.length === 0) {
      map.setView([ADDIS_ABABA.latitude, ADDIS_ABABA.longitude], CITY_ZOOM);
    } else {
      map.fitBounds(L.featureGroup(layers).getBounds(), { padding: [16, 16] });
    }
    return () => {
      map.remove();
    };
  }, [hexagons]);

  return (
    <div
      ref={container}
      className="h-96 w-full overflow-hidden rounded-xl border border-border"
      role="img"
      aria-label={`Map with ${String(hexagons.length)} zones`}
    />
  );
}
