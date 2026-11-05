import { Component, type ReactNode } from 'react';

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
      return (
        <p role="alert" className="p-6 text-center text-sm text-muted-foreground">
          The map could not load · ካርታው አልተጫነም
        </p>
      );
    }
    return this.props.children;
  }
}
