import {
  acceptResultSchema,
  driverBoardSchema,
  holdResultSchema,
  type Coordinates,
} from '@buchi/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../../components/api-context';

const boardKey = ['driver', 'board'] as const;

/**
 * Mini Apps cannot run in the background and jobs come from other drivers' actions too, so the
 * open board polls. The chat still carries every job alert.
 */
const BOARD_REFRESH_MS = 15_000;

export function useBoard() {
  const api = useApi();
  return useQuery({
    queryKey: boardKey,
    queryFn: () => api.get('/driver/board', driverBoardSchema),
    refetchInterval: BOARD_REFRESH_MS,
  });
}

function useBoardMutation<I, O>(mutationFn: (input: I) => Promise<O>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSettled: () => queryClient.invalidateQueries({ queryKey: boardKey }),
  });
}

export function useAccept() {
  const api = useApi();
  return useBoardMutation((offerId: string) =>
    api.send('POST', `/driver/offers/${offerId}/accept`, {}, acceptResultSchema),
  );
}

/** A far-area offer is held until the customer pays, so it has its own route. */
export function useHold() {
  const api = useApi();
  return useBoardMutation((offerId: string) =>
    api.send('POST', `/driver/offers/${offerId}/hold`, {}, holdResultSchema),
  );
}

export function usePickedUp() {
  const api = useApi();
  return useBoardMutation((jobId: string) =>
    api.sendOnly('POST', `/driver/jobs/${jobId}/picked-up`, {}),
  );
}

export function useDelivered() {
  const api = useApi();
  return useBoardMutation((input: { stopId: string; location: Coordinates }) =>
    api.sendOnly('POST', `/driver/stops/${input.stopId}/delivered`, input.location),
  );
}
