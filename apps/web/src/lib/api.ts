import type { z } from 'zod';
import { readError } from './api-error';
import type { Auth } from './auth';
import { followEventStream } from './sse';

type Method = 'POST' | 'PUT';

/** Calls the Buchi API with the bearer token and parses every response with its schema. */
export class Api {
  constructor(private readonly auth: Auth) {}

  get<T extends z.ZodType>(path: string, schema: T): Promise<z.infer<T>> {
    return this.request(path, { method: 'GET' }, schema);
  }

  send<T extends z.ZodType>(
    method: Method,
    path: string,
    body: unknown,
    schema: T,
  ): Promise<z.infer<T>> {
    return this.request(path, jsonInit(method, body), schema);
  }

  /** Posts a file as the raw body, typed by its own content type. */
  upload<T extends z.ZodType>(path: string, file: Blob, schema: T): Promise<z.infer<T>> {
    const init = { method: 'POST', headers: { 'content-type': file.type }, body: file };
    return this.request(path, init, schema);
  }

  /** A file such as an image, which the page shows through an object URL. */
  async blob(path: string): Promise<Blob> {
    return (await this.fetch(path, { method: 'GET' })).blob();
  }

  /** For routes that answer 204 No Content. */
  async sendOnly(method: Method, path: string, body: unknown): Promise<void> {
    await this.fetch(path, jsonInit(method, body));
  }

  /** Follows a Server-Sent Events stream with this client's token until `signal` aborts. */
  events(
    path: string,
    handlers: { onOpen: () => void; onData: (data: string) => void },
    signal: AbortSignal,
  ): Promise<void> {
    return followEventStream({ path, token: () => this.auth.token(), ...handlers, signal });
  }

  private async request<T extends z.ZodType>(
    path: string,
    init: RequestInit,
    schema: T,
  ): Promise<z.infer<T>> {
    const res = await this.fetch(path, init);
    return schema.parse(await res.json());
  }

  /** A rejected token signs in again once, because the server may have rotated its secret. */
  private async fetch(path: string, init: RequestInit): Promise<Response> {
    let res = await this.authorized(path, init);
    if (res.status === 401) {
      this.auth.invalidate();
      res = await this.authorized(path, init);
    }
    if (!res.ok) throw await readError(res);
    return res;
  }

  private async authorized(path: string, init: RequestInit): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('authorization', `Bearer ${await this.auth.token()}`);
    return fetch(path, { ...init, headers });
  }
}

function jsonInit(method: Method, body: unknown): RequestInit {
  return { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}
