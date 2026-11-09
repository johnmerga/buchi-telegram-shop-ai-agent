import { formatBirr, type DeliveryMap, type DeliveryMapJob } from '@buchi/shared';
import { useMemo } from 'react';
import { LazyRoutesMap } from '../../components/map/lazy-maps';
import type { MapRoute } from '../../components/map/routes-map';
import { QueryView } from '../../components/query-view';
import { EmptyState } from '../../components/screen-state';
import { Badge } from '../../components/ui/badge';
import { Card } from '../../components/ui/card';
import { TruckIcon } from '../../components/icons';
import { useT, type MessageKey } from '../../lib/i18n';
import { useDeliveries } from './dashboard-api';
import { useLiveReload } from './use-live-reload';
import { useShopId } from './use-shop-id';

const jobStatusLabels: Record<DeliveryMapJob['status'], MessageKey> = {
  offered: 'deliveries.offered',
  assigned: 'deliveries.assigned',
  picked_up: 'deliveries.pickedUp',
};

/** Every open delivery on one map, from the shop through its stops, kept live. */
export default function DeliveriesScreen() {
  const shopId = useShopId();
  const deliveries = useDeliveries(shopId);
  const { t } = useT();
  useLiveReload(shopId, 'deliveries');
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">{t('nav.deliveries')}</h2>
      <QueryView query={deliveries}>{(map) => <Deliveries map={map} />}</QueryView>
    </div>
  );
}

function Deliveries({ map }: { map: DeliveryMap }) {
  const { t } = useT();
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
      <EmptyState title={t('deliveries.empty')} icon={<TruckIcon />}>
        {t('deliveries.emptyHint')}
      </EmptyState>
    );
  }
  return (
    <>
      <LazyRoutesMap routes={routes} />
      {map.jobs.map((job) => (
        <Card key={job.jobId} className="flex flex-col gap-1 text-sm">
          <div className="flex items-start justify-between gap-2">
            <p className="font-medium">{t(jobStatusLabels[job.status])}</p>
            <p className="font-semibold">{formatBirr(job.payout)}</p>
          </div>
          <p className="text-muted-foreground">
            {job.driverName ?? t('deliveries.noDriver')} ·{' '}
            {job.stops.length === 1
              ? t('deliveries.oneStop')
              : t('deliveries.stops', { count: job.stops.length })}{' '}
            ·{' '}
            {t('deliveries.delivered', {
              count: job.stops.filter((stop) => stop.delivered).length,
            })}
          </p>
          {job.far && <Badge tone="primary">{t('delivery.far')}</Badge>}
        </Card>
      ))}
    </>
  );
}
