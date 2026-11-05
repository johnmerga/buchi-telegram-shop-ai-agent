/**
 * An in-memory cache whose entries expire after `ttlMs`. When it is full, it drops the oldest entry,
 * so memory stays bounded on the single small server.
 */
export class TtlCache<V> {
  private readonly entries = new Map<string, { value: V; expiresAt: number }>();

  constructor(private readonly options: { ttlMs: number; maxEntries: number; now: () => Date }) {}

  get(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.options.now().getTime()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: V): void {
    this.entries.delete(key);
    const oldest = this.entries.keys().next();
    if (this.entries.size >= this.options.maxEntries && !oldest.done) {
      this.entries.delete(oldest.value);
    }
    this.entries.set(key, { value, expiresAt: this.options.now().getTime() + this.options.ttlMs });
  }
}
