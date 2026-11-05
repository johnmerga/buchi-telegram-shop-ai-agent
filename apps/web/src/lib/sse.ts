/**
 * Reads a Server-Sent Events stream with `fetch`, because `EventSource` cannot send the bearer
 * token. Calls `onData` with each event's data and resolves when the stream ends.
 */
export async function readEventStream(
  res: Response,
  onData: (data: string) => void,
): Promise<void> {
  if (!res.body) return;
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += value;
    const events = buffer.split('\n\n');
    // The last part is an event that has not fully arrived yet.
    buffer = events.pop() ?? '';
    for (const event of events) {
      const data = event
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice('data:'.length).trimStart())
        .join('\n');
      if (data !== '') onData(data);
    }
  }
}

const FIRST_RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;

/**
 * Keeps a stream open until `signal` aborts, reconnecting with a growing delay. `onOpen` runs on
 * every connection, so the caller can reload what it may have missed while disconnected.
 */
export async function followEventStream(options: {
  path: string;
  token: () => Promise<string>;
  onOpen: () => void;
  onData: (data: string) => void;
  signal: AbortSignal;
  wait?: (ms: number) => Promise<void>;
}): Promise<void> {
  const { path, token, onOpen, onData, signal } = options;
  const wait = options.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  let delay = FIRST_RETRY_MS;
  while (!signal.aborted) {
    try {
      const res = await fetch(path, {
        headers: { authorization: `Bearer ${await token()}` },
        signal,
      });
      if (res.ok) {
        delay = FIRST_RETRY_MS;
        onOpen();
        await readEventStream(res, onData);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      // A dropped connection is expected on mobile networks; the loop retries it.
      console.warn('Live updates disconnected', err);
    }
    await wait(delay);
    delay = Math.min(delay * 2, MAX_RETRY_MS);
  }
}
