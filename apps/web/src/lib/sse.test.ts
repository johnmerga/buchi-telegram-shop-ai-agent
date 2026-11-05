import { describe, expect, it, vi } from 'vitest';
import { followEventStream, readEventStream } from './sse';

function streamOf(chunks: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    },
  });
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
}

describe('readEventStream', () => {
  it('joins events split across chunks and skips comments', async () => {
    const received: string[] = [];
    await readEventStream(
      streamOf([': connected\n\n', 'data: {"a"', ':1}\n\ndata: {"b":2}\n', '\n: ping\n\n']),
      (data) => received.push(data),
    );
    expect(received).toEqual(['{"a":1}', '{"b":2}']);
  });
});

describe('followEventStream', () => {
  it('reconnects after the stream ends and reports each connection', async () => {
    const abort = new AbortController();
    let connections = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        connections += 1;
        return Promise.resolve(streamOf([`data: ${String(connections)}\n\n`]));
      }),
    );
    const onOpen = vi.fn();
    const received: string[] = [];
    const waits: number[] = [];
    await followEventStream({
      path: '/shops/s1/events',
      token: () => Promise.resolve('t'),
      onOpen,
      onData: (data) => received.push(data),
      signal: abort.signal,
      wait: (ms) => {
        waits.push(ms);
        if (waits.length === 2) abort.abort();
        return Promise.resolve();
      },
    });
    expect(received).toEqual(['1', '2']);
    expect(onOpen).toHaveBeenCalledTimes(2);
    expect(waits).toEqual([1000, 1000]);
  });
});
