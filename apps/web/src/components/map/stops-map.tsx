import type { Coordinates } from '@buchi/shared';
import L from 'leaflet';
import { useEffect, useRef } from 'react';
import { pinIcon, tileLayer } from './leaflet-setup';

export interface MapStop {
  label: string;
  point: Coordinates;
}

/** A read-only map of labelled points, zoomed to show them all. */
export default function StopsMap({ stops }: { stops: MapStop[] }) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!container.current || stops.length === 0) return;
    const map = L.map(container.current);
    tileLayer().addTo(map);
    const points = stops.map(({ label, point }) => {
      const latLng = L.latLng(point.latitude, point.longitude);
      L.marker(latLng, { icon: pinIcon(label), keyboard: false }).addTo(map);
      return latLng;
    });
    map.fitBounds(L.latLngBounds(points), { padding: [32, 32], maxZoom: 16 });
    return () => {
      map.remove();
    };
  }, [stops]);

  return (
    <div
      ref={container}
      className="h-56 w-full overflow-hidden rounded-xl border border-border"
      role="img"
      aria-label={`Map with ${String(stops.length)} points`}
    />
  );
}
