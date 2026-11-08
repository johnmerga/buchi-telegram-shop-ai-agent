import {
  channelPostSchema,
  connectedChannelSchema,
  createdShopSchema,
  deliverySettingsViewSchema,
  driverInviteLinkSchema,
  driverListItemSchema,
  orderBoardItemSchema,
  productSchema,
  productWithVariantsSchema,
  shopDetailsSchema,
  shopSchema,
  type ConnectChannelInput,
  type CreateShopInput,
  type DeliverySettings,
  type DriverInvite,
  type PaymentAccount,
  type ProductInput,
  type SaverRunTimes,
  type ShopLocation,
  type VariantInput,
} from '@buchi/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { useApi } from '../../components/api-context';

export const ownerKeys = {
  shops: ['shops'] as const,
  shop: (shopId: string) => ['shops', shopId] as const,
  orders: (shopId: string) => ['shops', shopId, 'orders'] as const,
  products: (shopId: string) => ['shops', shopId, 'products'] as const,
  drivers: (shopId: string) => ['shops', shopId, 'drivers'] as const,
  delivery: (shopId: string) => ['shops', shopId, 'delivery'] as const,
  paymentReviews: (shopId: string) => ['shops', shopId, 'payment-reviews'] as const,
  /** Under the review queue's key, so a decision or a live event reloads both. */
  paymentDecisions: (shopId: string) => ['shops', shopId, 'payment-reviews', 'decisions'] as const,
  conversations: (shopId: string) => ['shops', shopId, 'conversations'] as const,
  aiDecisions: (shopId: string) => ['shops', shopId, 'ai-decisions'] as const,
  deliveries: (shopId: string) => ['shops', shopId, 'deliveries'] as const,
  zones: (shopId: string) => ['shops', shopId, 'zones'] as const,
  insights: (shopId: string) => ['shops', shopId, 'insights'] as const,
  ledger: (shopId: string) => ['shops', shopId, 'ledger'] as const,
};

export function useShops() {
  const api = useApi();
  return useQuery({
    queryKey: ownerKeys.shops,
    queryFn: () => api.get('/shops', z.array(shopSchema)),
  });
}

export function useShop(shopId: string) {
  const api = useApi();
  return useQuery({
    queryKey: ownerKeys.shop(shopId),
    queryFn: () => api.get(`/shops/${shopId}`, shopDetailsSchema),
  });
}

export function useOrders(shopId: string) {
  const api = useApi();
  return useQuery({
    queryKey: ownerKeys.orders(shopId),
    queryFn: () => api.get(`/shops/${shopId}/orders`, z.array(orderBoardItemSchema)),
  });
}

export function useProducts(shopId: string) {
  const api = useApi();
  return useQuery({
    queryKey: ownerKeys.products(shopId),
    queryFn: () => api.get(`/shops/${shopId}/products`, z.array(productWithVariantsSchema)),
  });
}

export function useDrivers(shopId: string) {
  const api = useApi();
  return useQuery({
    queryKey: ownerKeys.drivers(shopId),
    queryFn: () => api.get(`/shops/${shopId}/drivers`, z.array(driverListItemSchema)),
  });
}

export function useDeliverySettings(shopId: string) {
  const api = useApi();
  return useQuery({
    queryKey: ownerKeys.delivery(shopId),
    queryFn: () => api.get(`/shops/${shopId}/delivery-settings`, deliverySettingsViewSchema),
  });
}

/** A mutation that reloads `invalidates` once it succeeds. */
function useOwnerMutation<I, O>(
  mutationFn: (input: I) => Promise<O>,
  invalidates: readonly string[],
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: invalidates }),
  });
}

export function useCreateShop() {
  const api = useApi();
  return useOwnerMutation(
    (input: CreateShopInput) => api.send('POST', '/shops', input, createdShopSchema),
    ownerKeys.shops,
  );
}

/** Deletes the shop, then forgets everything cached about it and reloads the shop list. */
export function useDeleteShop(shopId: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.sendOnly('DELETE', `/shops/${shopId}`, { name }),
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: ownerKeys.shop(shopId) });
      await queryClient.invalidateQueries({ queryKey: ownerKeys.shops, exact: true });
    },
  });
}

export function useConnectChannel(shopId: string) {
  const api = useApi();
  return useOwnerMutation(
    (input: ConnectChannelInput) =>
      api.send('POST', `/shops/${shopId}/channel`, input, connectedChannelSchema),
    ownerKeys.shop(shopId),
  );
}

export function useSetLocation(shopId: string) {
  const api = useApi();
  return useOwnerMutation(
    (input: ShopLocation) => api.sendOnly('PUT', `/shops/${shopId}/location`, input),
    ownerKeys.shop(shopId),
  );
}

export function useSetPaymentAccounts(shopId: string) {
  const api = useApi();
  return useOwnerMutation(
    (input: PaymentAccount[]) => api.sendOnly('PUT', `/shops/${shopId}/payment-accounts`, input),
    ownerKeys.shop(shopId),
  );
}

export function useSaveDeliverySettings(shopId: string) {
  const api = useApi();
  return useOwnerMutation(
    (input: DeliverySettings) => api.sendOnly('PUT', `/shops/${shopId}/delivery-settings`, input),
    ownerKeys.delivery(shopId),
  );
}

export function useSaveSaverRunTimes(shopId: string) {
  const api = useApi();
  return useOwnerMutation(
    (input: SaverRunTimes) => api.sendOnly('PUT', `/shops/${shopId}/saver-run-times`, input),
    ownerKeys.delivery(shopId),
  );
}

/** Saves the product, then its sizes, because a new product needs its ID for the sizes. */
export function useSaveProduct(shopId: string, productId: string | undefined) {
  const api = useApi();
  return useOwnerMutation(async (input: { product: ProductInput; variants: VariantInput[] }) => {
    const saved = productId
      ? await api.send(
          'PUT',
          `/shops/${shopId}/products/${productId}`,
          input.product,
          productSchema,
        )
      : await api.send('POST', `/shops/${shopId}/products`, input.product, productSchema);
    await api.sendOnly('PUT', `/shops/${shopId}/products/${saved.id}/variants`, input.variants);
    return saved;
  }, ownerKeys.products(shopId));
}

export function useAddPhoto(shopId: string, productId: string) {
  const api = useApi();
  return useOwnerMutation(
    (photo: File) =>
      api.upload(`/shops/${shopId}/products/${productId}/photos`, photo, productSchema),
    ownerKeys.products(shopId),
  );
}

/** A photo's index is its place in the product's list, which only ever grows. */
export function useProductPhoto(shopId: string, productId: string, index: number) {
  const api = useApi();
  return useQuery({
    queryKey: [...ownerKeys.products(shopId), productId, 'photos', index],
    queryFn: () => api.blob(`/shops/${shopId}/products/${productId}/photos/${String(index)}`),
    staleTime: Infinity,
  });
}

export function usePostToChannel(shopId: string) {
  const api = useApi();
  return useMutation({
    mutationFn: (productId: string) =>
      api.send('POST', `/shops/${shopId}/products/${productId}/post`, {}, channelPostSchema),
  });
}

export function useInviteDriver(shopId: string) {
  const api = useApi();
  return useOwnerMutation(
    (input: DriverInvite) =>
      api.send('POST', `/shops/${shopId}/drivers`, input, driverInviteLinkSchema),
    ownerKeys.drivers(shopId),
  );
}
