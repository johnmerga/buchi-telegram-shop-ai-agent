import { lazy, Suspense, type ComponentProps, type ReactNode } from 'react';
import { useT } from '../../lib/i18n';
import { Loading } from '../screen-state';
import { MapBoundary } from './map-boundary';

// Leaflet is large, so it loads only when a screen shows a map.
const PinPickerMap = lazy(() => import('./pin-picker-map'));
const StopsMap = lazy(() => import('./stops-map'));
const RoutesMap = lazy(() => import('./routes-map'));
const HexMap = lazy(() => import('./hex-map'));

function MapFrame({ children }: { children: ReactNode }) {
  const { t } = useT();
  return (
    <MapBoundary>
      <Suspense fallback={<Loading label={t('map.loading')} />}>{children}</Suspense>
    </MapBoundary>
  );
}

export function LazyPinPickerMap(props: ComponentProps<typeof PinPickerMap>) {
  return (
    <MapFrame>
      <PinPickerMap {...props} />
    </MapFrame>
  );
}

export function LazyStopsMap(props: ComponentProps<typeof StopsMap>) {
  return (
    <MapFrame>
      <StopsMap {...props} />
    </MapFrame>
  );
}

export function LazyRoutesMap(props: ComponentProps<typeof RoutesMap>) {
  return (
    <MapFrame>
      <RoutesMap {...props} />
    </MapFrame>
  );
}

export function LazyHexMap(props: ComponentProps<typeof HexMap>) {
  return (
    <MapFrame>
      <HexMap {...props} />
    </MapFrame>
  );
}
