import { Component, type ReactNode } from 'react';
import { useT } from '../../lib/i18n';

/**
 * Keeps a screen working when its map fails, for example when the Leaflet bundle cannot load on a
 * weak connection. Every map screen also shows its data as a list, which stays usable.
 */
export class MapBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render() {
    if (this.state.failed) {
      return <MapFailed />;
    }
    return this.props.children;
  }
}

function MapFailed() {
  const { t } = useT();
  return (
    <p role="alert" className="p-6 text-center text-sm text-muted-foreground">
      {t('map.failed')}
    </p>
  );
}
