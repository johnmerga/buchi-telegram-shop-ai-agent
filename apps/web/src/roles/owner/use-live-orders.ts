import { liveEventSchema } from '@buchi/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useApi } from '../../components/api-context';
import { ownerKeys } from './owner-api';

/**
 * Reloads the order board whenever the server reports an order change, and after every reconnect,
 * because events sent while disconnected are lost.
 */
export function useLiveOrders(shopId: string): void {
  const api = useApi();
  const queryClient = useQueryClient();

  useEffect(() => {
    const abort = new AbortController();
    const reload = () => void queryClient.invalidateQueries({ queryKey: ownerKeys.orders(shopId) });
    void api.events(
      `/shops/${shopId}/events`,
      {
        onOpen: reload,
        onData: (data) => {
          if (liveEventSchema.safeParse(parseJson(data)).success) reload();
        },
      },
      abort.signal,
    );
    return () => {
      abort.abort();
    };
  }, [api, queryClient, shopId]);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
