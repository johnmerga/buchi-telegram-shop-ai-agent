import L from 'leaflet';
import { useEffect, useRef } from 'react';
import { ADDIS_ABABA } from './default-center';
import { pinIcon, tileLayer } from './leaflet-setup';
import type { MapStop } from './stops-map';

/** One delivery's way: from the shop through its stops in order. */
export interface MapRoute {
  id: string;
  stops: MapStop[];
}

const CITY_ZOOM = 12;

/** A read-only map of routes, each drawn as a line through its labelled stops. */
export default function RoutesMap({ routes }: { routes: MapRoute[] }) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!container.current) return;
    const map = L.map(container.current);
    tileLayer().addTo(map);
    const points: L.LatLng[] = [];
    for (const route of routes) {
      const line = route.stops.map(({ label, point }) => {
        const latLng = L.latLng(point.latitude, point.longitude);
        L.marker(latLng, { icon: pinIcon(label), keyboard: false }).addTo(map);
        return latLng;
      });
      L.polyline(line, { className: 'map-route', weight: 3 }).addTo(map);
      points.push(...line);
    }
    if (points.length === 0) {
      map.setView([ADDIS_ABABA.latitude, ADDIS_ABABA.longitude], CITY_ZOOM);
    } else {
      map.fitBounds(L.latLngBounds(points), { padding: [32, 32], maxZoom: 15 });
    }
    return () => {
      map.remove();
    };
  }, [routes]);

  return (
    <div
      ref={container}
      className="h-80 w-full overflow-hidden rounded-xl border border-border"
      role="img"
      aria-label={`Map with ${String(routes.length)} deliveries`}
    />
  );
}
