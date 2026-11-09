import { formatBirr, trackedOrderSchema, type OrderStatus, type TrackedOrder } from '@buchi/shared';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { useApi } from '../../components/api-context';
import { QueryView } from '../../components/query-view';
import { Badge } from '../../components/ui/badge';
import { Card } from '../../components/ui/card';
import { cn } from '../../lib/cn';
import { useT } from '../../lib/i18n';

/** A customer checks back now and then, so a minute is fresh enough and spares their data. */
const REFRESH_MS = 60_000;

const deliverySteps: OrderStatus[] = [
  'awaiting_payment',
  'verifying',
  'paid',
  'dispatching',
  'assigned',
  'out_for_delivery',
  'delivered',
];
const pickupSteps: OrderStatus[] = [
  'awaiting_payment',
  'verifying',
  'paid',
  'ready_for_pickup',
  'delivered',
];

function stepsFor(order: TrackedOrder): OrderStatus[] {
  if (order.deliveryType === 'pickup') return pickupSteps;
  // A far-area order first waits for a driver's price.
  return order.deliveryType === 'far' ? ['quoting', ...deliverySteps] : deliverySteps;
}

export default function OrderTrackingScreen() {
  const { orderId = '' } = useParams();
  const api = useApi();
  const order = useQuery({
    queryKey: ['customer', 'order', orderId],
    queryFn: () => api.get(`/customer/orders/${orderId}`, trackedOrderSchema),
    refetchInterval: REFRESH_MS,
  });
  return <QueryView query={order}>{(data) => <Tracking order={data} />}</QueryView>;
}

function Tracking({ order }: { order: TrackedOrder }) {
  const steps = stepsFor(order);
  // Review is a detour of the payment check, so it lights the same step.
  const current = steps.indexOf(order.status === 'needs_review' ? 'verifying' : order.status);
  const closed = ['expired', 'cancelled', 'payment_rejected'].includes(order.status);
  const { t, formatTime } = useT();
  return (
    <>
      <h1 className="text-xl font-semibold">{t('tracking.title')}</h1>
      <Card className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <p className="font-medium">{order.shopName}</p>
          <Badge tone={closed ? 'warning' : 'primary'}>{t(`status.${order.status}`)}</Badge>
        </div>
        <ul className="text-sm">
          {order.lines.map((line, index) => (
            <li key={index}>
              {line.quantity} × {line.title} · {t('orders.size', { size: line.size })}
            </li>
          ))}
        </ul>
        <p className="text-sm">
          <span className="font-semibold">{formatBirr(order.total)}</span> ·{' '}
          {t(`delivery.${order.deliveryType}`)}
        </p>
        {order.status === 'awaiting_payment' && order.paymentDeadline && (
          <p className="text-sm">
            {t('tracking.payBy', { time: formatTime(order.paymentDeadline) })}
          </p>
        )}
      </Card>
      {!closed && (
        <ol aria-label={t('tracking.progress')} className="flex flex-col">
          {steps.map((step, index) => (
            <li
              key={step}
              aria-current={index === current ? 'step' : undefined}
              className="flex items-stretch gap-3"
            >
              <span className="flex w-5 flex-col items-center">
                <span
                  className={cn(
                    'mt-2.5 size-3 shrink-0 rounded-full border-2',
                    index < current && 'border-primary bg-primary',
                    index === current && 'border-primary bg-primary ring-4 ring-primary/20',
                    index > current && 'border-border bg-background',
                  )}
                />
                {index < steps.length - 1 && (
                  <span
                    className={cn('w-0.5 flex-1', index < current ? 'bg-primary' : 'bg-border')}
                  />
                )}
              </span>
              <span
                className={cn(
                  'py-1.5 text-sm',
                  index === current ? 'font-semibold text-foreground' : 'text-muted-foreground',
                )}
              >
                {t(`status.${step}`)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
