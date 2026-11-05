import { lazy, Suspense, type ComponentProps } from 'react';
import { Loading } from '../screen-state';

// Leaflet is large, so it loads only when a screen shows a map.
const PinPickerMap = lazy(() => import('./pin-picker-map'));
const StopsMap = lazy(() => import('./stops-map'));

export function LazyPinPickerMap(props: ComponentProps<typeof PinPickerMap>) {
  return (
    <Suspense fallback={<Loading label="Loading the map…" />}>
      <PinPickerMap {...props} />
    </Suspense>
  );
}

export function LazyStopsMap(props: ComponentProps<typeof StopsMap>) {
  return (
    <Suspense fallback={<Loading label="Loading the map…" />}>
      <StopsMap {...props} />
    </Suspense>
  );
}
