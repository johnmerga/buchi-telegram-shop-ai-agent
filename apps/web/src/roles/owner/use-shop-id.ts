import { useParams } from 'react-router';

/** The shop in the URL. Every screen that calls this sits under the `shops/:shopId` route. */
export function useShopId(): string {
  const { shopId } = useParams();
  if (shopId === undefined) throw new Error('useShopId needs the shops/:shopId route');
  return shopId;
}
