import { liveEventSchema } from '@buchi/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useApi } from '../../components/api-context';

/**
 * Reloads a screen's query, such as `['shops', shopId, 'orders']`, whenever the server reports an
 * order change, and after every reconnect, because events sent while disconnected are lost.
 */
export function useLiveReload(
  shopId: string,
  section: 'orders' | 'payment-reviews' | 'deliveries',
): void {
  const api = useApi();
  const queryClient = useQueryClient();

  useEffect(() => {
    const abort = new AbortController();
    const reload = () =>
      void queryClient.invalidateQueries({ queryKey: ['shops', shopId, section] });
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
  }, [api, queryClient, shopId, section]);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
