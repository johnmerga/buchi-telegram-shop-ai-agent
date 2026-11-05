import { formatBirr, type DeliveryMap, type DeliveryMapJob } from '@buchi/shared';
import { useMemo } from 'react';
import { LazyRoutesMap } from '../../components/map/lazy-maps';
import type { MapRoute } from '../../components/map/routes-map';
import { QueryView } from '../../components/query-view';
import { EmptyState } from '../../components/screen-state';
import { Badge } from '../../components/ui/badge';
import { Card } from '../../components/ui/card';
import { useDeliveries } from './dashboard-api';
import { useLiveReload } from './use-live-reload';
import { useShopId } from './use-shop-id';

const jobStatusLabels: Record<DeliveryMapJob['status'], string> = {
  offered: 'Finding a driver',
  assigned: 'Driver on the way to the shop',
  picked_up: 'On the way to customers',
};

/** Every open delivery on one map, from the shop through its stops, kept live. */
export default function DeliveriesScreen() {
  const shopId = useShopId();
  const deliveries = useDeliveries(shopId);
  useLiveReload(shopId, 'deliveries');
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Deliveries · ማድረሻዎች</h2>
      <QueryView query={deliveries}>{(map) => <Deliveries map={map} />}</QueryView>
    </div>
  );
}

function Deliveries({ map }: { map: DeliveryMap }) {
  const routes = useMemo<MapRoute[]>(
    () =>
      map.jobs.map((job) => ({
        id: job.jobId,
        stops: [
          ...(map.shopPin ? [{ label: 'S', point: map.shopPin }] : []),
          ...job.stops.flatMap((stop) =>
            stop.pin ? [{ label: String(stop.position), point: stop.pin }] : [],
          ),
        ],
      })),
    [map],
  );
  if (map.jobs.length === 0) {
    return (
      <EmptyState title="No open deliveries · ክፍት ማድረሻ የለም">
        Paid delivery orders appear here while they wait for a driver and while they are on the way.
      </EmptyState>
    );
  }
  return (
    <>
      <LazyRoutesMap routes={routes} />
      {map.jobs.map((job) => (
        <Card key={job.jobId} className="flex flex-col gap-1 text-sm">
          <div className="flex items-start justify-between gap-2">
            <p className="font-medium">{jobStatusLabels[job.status]}</p>
            <p className="font-semibold">{formatBirr(job.payout)}</p>
          </div>
          <p className="text-muted-foreground">
            {job.driverName ?? 'No driver yet'} ·{' '}
            {job.stops.length === 1 ? '1 stop' : `${String(job.stops.length)} stops`} ·{' '}
            {job.stops.filter((stop) => stop.delivered).length} delivered
          </p>
          {job.far && <Badge tone="primary">Far area</Badge>}
        </Card>
      ))}
    </>
  );
}
