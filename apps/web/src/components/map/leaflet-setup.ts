import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export function tileLayer(): L.TileLayer {
  return L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  });
}

/** An HTML pin, because Leaflet's image icons break when a bundler renames the image files. */
export function pinIcon(label: string): L.DivIcon {
  const text = document.createElement('span');
  text.textContent = label;
  return L.divIcon({
    className: '',
    html: `<div class="map-pin">${text.outerHTML}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 28],
  });
}
