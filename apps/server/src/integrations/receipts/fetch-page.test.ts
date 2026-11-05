import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, describe, expect, it } from 'vitest';
import { timedFetch } from './fetch-page';

// A server that never answers, like a receipt page that blocks foreign IP addresses.
const server = createServer(() => undefined);
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
afterAll(() => {
  server.closeAllConnections();
  server.close();
});

describe('timedFetch', () => {
  it('gives up after the timeout', async () => {
    // A server listening on a TCP port reports an address object, not a pipe name.
    const { port } = server.address() as AddressInfo;
    await expect(timedFetch(50)(`http://127.0.0.1:${String(port)}/`)).rejects.toThrow();
  });
});
