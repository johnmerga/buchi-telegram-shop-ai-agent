import { formatBirr, trackedOrderSchema, type OrderStatus, type TrackedOrder } from '@buchi/shared';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { useApi } from '../../components/api-context';
import { QueryView } from '../../components/query-view';
import { Badge } from '../../components/ui/badge';
import { Card } from '../../components/ui/card';
import { cn } from '../../lib/cn';
import { deliveryLabels, formatTime, statusLabels } from '../../lib/labels';

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
  return (
    <>
      <h1 className="text-xl font-semibold">Your order · ትዕዛዝዎ</h1>
      <Card className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <p className="font-medium">{order.shopName}</p>
          <Badge tone={closed ? 'warning' : 'primary'}>{statusLabels[order.status]}</Badge>
        </div>
        <ul className="text-sm">
          {order.lines.map((line, index) => (
            <li key={index}>
              {line.quantity} × {line.title} · size {line.size}
            </li>
          ))}
        </ul>
        <p className="text-sm">
          <span className="font-semibold">{formatBirr(order.total)}</span> ·{' '}
          {deliveryLabels[order.deliveryType]}
        </p>
        {order.status === 'awaiting_payment' && order.paymentDeadline && (
          <p className="text-sm">Pay by {formatTime(order.paymentDeadline)}.</p>
        )}
      </Card>
      {!closed && (
        <ol aria-label="Progress" className="flex flex-col gap-1">
          {steps.map((step, index) => (
            <li
              key={step}
              aria-current={index === current ? 'step' : undefined}
              className={cn(
                'rounded-lg px-3 py-2 text-sm',
                index < current && 'text-muted-foreground line-through',
                index === current && 'bg-primary font-semibold text-primary-foreground',
                index > current && 'text-muted-foreground',
              )}
            >
              {statusLabels[step]}
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
