export type FetchPage = (url: string) => Promise<Response>;

/** Fetches with a timeout, because the pages are unofficial and sometimes hang. A timeout rejects. */
export function timedFetch(timeoutMs: number): FetchPage {
  return (url) => fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
}
