import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderResult } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { LanguageProvider } from '../lib/i18n';
import { vi } from 'vitest';
import type { WebApp } from '../lib/telegram';

type Handler = (init: RequestInit | undefined) => Response | Promise<Response>;

export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export const session = () =>
  json(200, { token: 'test-token', expiresAt: new Date(Date.now() + 3_600_000).toISOString() });

/**
 * Replaces `fetch` with handlers keyed by "METHOD /path". An unknown request fails the test, so
 * a screen cannot quietly call an endpoint the test did not expect.
 */
export function fakeServer(handlers: Record<string, Handler>) {
  const calls: { key: string; init: RequestInit | undefined }[] = [];
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const path = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const key = `${init?.method ?? 'GET'} ${path}`;
    calls.push({ key, init });
    const handler = handlers[key];
    if (!handler) throw new Error(`Unexpected request: ${key}`);
    return Promise.resolve(handler(init));
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls };
}

/**
 * Puts a fake Telegram Mini App API on the page, as Telegram's script would. Returns the mocks
 * that tests inspect next to the API itself.
 */
export function fakeTelegram(overrides: Partial<WebApp> = {}) {
  const button = { onClick: vi.fn(), offClick: vi.fn(), show: vi.fn(), hide: vi.fn() };
  const mainButtonOnClick = vi.fn<(callback: () => void) => void>();
  const sendData = vi.fn<(data: string) => void>();
  const webApp: WebApp = {
    initData: 'query_id=1&user=%7B%22id%22%3A42%7D&auth_date=1&hash=abc',
    platform: 'android',
    ready: vi.fn(),
    expand: vi.fn(),
    close: vi.fn(),
    sendData,
    openTelegramLink: vi.fn(),
    BackButton: button,
    MainButton: {
      ...button,
      onClick: mainButtonOnClick,
      setParams: vi.fn(),
      showProgress: vi.fn(),
      hideProgress: vi.fn(),
    },
    ...overrides,
  };
  window.Telegram = { WebApp: webApp };
  return { webApp, mainButtonOnClick, sendData };
}

export function renderAt(path: string, ui: ReactNode): RenderResult {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>
      </LanguageProvider>
    </QueryClientProvider>,
  );
}
