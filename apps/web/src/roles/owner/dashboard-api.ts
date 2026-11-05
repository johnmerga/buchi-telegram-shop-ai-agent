import {
  deliveryMapSchema,
  insightsSchema,
  ledgerSettingsSchema,
  zoneMapSchema,
  type DailyReportName,
  type LedgerConnectInput,
} from '@buchi/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../../components/api-context';
import { ownerKeys } from './owner-api';

/** The owner's maps, insights, ledger, and Run now. */

export function useDeliveries(shopId: string) {
  const api = useApi();
  return useQuery({
    queryKey: ownerKeys.deliveries(shopId),
    queryFn: () => api.get(`/shops/${shopId}/deliveries`, deliveryMapSchema),
  });
}

export function useZones(shopId: string) {
  const api = useApi();
  return useQuery({
    queryKey: ownerKeys.zones(shopId),
    queryFn: () => api.get(`/shops/${shopId}/zones`, zoneMapSchema),
  });
}

export function useInsights(shopId: string) {
  const api = useApi();
  return useQuery({
    queryKey: ownerKeys.insights(shopId),
    queryFn: () => api.get(`/shops/${shopId}/insights`, insightsSchema),
  });
}

export function useLedger(shopId: string) {
  const api = useApi();
  return useQuery({
    queryKey: ownerKeys.ledger(shopId),
    queryFn: () => api.get(`/shops/${shopId}/ledger`, ledgerSettingsSchema),
  });
}

export function useConnectLedger(shopId: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: LedgerConnectInput) =>
      api.send('PUT', `/shops/${shopId}/ledger`, input, ledgerSettingsSchema),
    onSuccess: (settings) => {
      queryClient.setQueryData(ownerKeys.ledger(shopId), settings);
    },
  });
}

export function useRunReport(shopId: string) {
  const api = useApi();
  return useMutation({
    mutationFn: (report: DailyReportName) =>
      api.sendOnly('POST', `/shops/${shopId}/reports/${report}`, {}),
  });
}
