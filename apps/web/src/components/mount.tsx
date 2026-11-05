import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { startMiniApp } from '../lib/telegram';
import '../styles.css';

/** Starts one role's app at `/app/<role>`, the path the server serves its page from. */
export function mount(role: 'owner' | 'driver' | 'customer', app: ReactNode): void {
  const root = document.getElementById('root');
  if (!root) throw new Error('The page has no #root element');
  startMiniApp();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true } },
  });
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter basename={`/app/${role}`}>{app}</BrowserRouter>
      </QueryClientProvider>
    </StrictMode>,
  );
}
