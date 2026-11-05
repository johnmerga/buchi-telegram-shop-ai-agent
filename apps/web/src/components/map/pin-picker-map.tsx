import type { Coordinates } from '@buchi/shared';
import L from 'leaflet';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { pinIcon, tileLayer } from './leaflet-setup';

const START_ZOOM = 16;

/** A map with one pin that the user drags, or moves by tapping the map. */
export default function PinPickerMap({
  value,
  onChange,
}: {
  value: Coordinates;
  onChange: (point: Coordinates) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const view = useRef<{ map: L.Map; pin: L.Marker }>(null);
  const [start] = useState(value);
  const moved = useEffectEvent((latLng: L.LatLng) => {
    onChange({ latitude: latLng.lat, longitude: latLng.lng });
  });

  useEffect(() => {
    if (!container.current) return;
    const center = L.latLng(start.latitude, start.longitude);
    const map = L.map(container.current).setView(center, START_ZOOM);
    tileLayer().addTo(map);
    const pin = L.marker(center, { draggable: true, icon: pinIcon('📍'), autoPan: true });
    pin.addTo(map).on('dragend', () => {
      moved(pin.getLatLng());
    });
    map.on('click', (event: L.LeafletMouseEvent) => {
      pin.setLatLng(event.latlng);
      moved(event.latlng);
    });
    view.current = { map, pin };
    return () => {
      map.remove();
      view.current = null;
    };
  }, [start]);

  // A point chosen outside the map, such as "Use my location", moves the pin and the view.
  useEffect(() => {
    if (!view.current) return;
    const { map, pin } = view.current;
    const point = L.latLng(value.latitude, value.longitude);
    if (!pin.getLatLng().equals(point)) {
      pin.setLatLng(point);
      map.panTo(point);
    }
  }, [value]);

  return (
    <div
      ref={container}
      className="h-80 w-full overflow-hidden rounded-xl border border-border"
      aria-label="Map. Drag the pin or tap the map to move it."
      role="application"
    />
  );
}
