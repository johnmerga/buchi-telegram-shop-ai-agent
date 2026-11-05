import type { LiveEvent } from '@buchi/shared';

type Listener = (event: LiveEvent) => void;

/** Fans each shop's domain events out to the dashboards that are open for that shop. */
export class LiveEvents {
  private readonly listeners = new Map<string, Set<Listener>>();

  /** Returns the function that stops listening. */
  listen(shopId: string, listener: Listener): () => void {
    const shopListeners = this.listeners.get(shopId) ?? new Set<Listener>();
    shopListeners.add(listener);
    this.listeners.set(shopId, shopListeners);
    return () => {
      shopListeners.delete(listener);
      if (shopListeners.size === 0) this.listeners.delete(shopId);
    };
  }

  publish(shopId: string, event: LiveEvent): void {
    for (const listener of this.listeners.get(shopId) ?? []) listener(event);
  }
}
