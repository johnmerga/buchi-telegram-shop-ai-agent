import { createContext, useContext, type ReactNode } from 'react';
import type { Api } from '../lib/api';

const ApiContext = createContext<Api | undefined>(undefined);

export function ApiProvider({ api, children }: { api: Api; children: ReactNode }) {
  return <ApiContext value={api}>{children}</ApiContext>;
}

/** The signed-in API client. Only screens inside `SignInGate` call it. */
export function useApi(): Api {
  const api = useContext(ApiContext);
  if (!api) throw new Error('useApi needs an ApiProvider');
  return api;
}
