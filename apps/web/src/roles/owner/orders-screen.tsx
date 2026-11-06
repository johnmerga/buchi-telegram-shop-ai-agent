import { formatBirr, type OrderBoardItem, type OrderStatus } from '@buchi/shared';
import { QueryView } from '../../components/query-view';
import { EmptyState } from '../../components/screen-state';
import { Badge } from '../../components/ui/badge';
import { Card } from '../../components/ui/card';
import { deliveryLabels, formatTime, statusLabels } from '../../lib/labels';
import { useOrders } from './owner-api';
import { useLiveReload } from './use-live-reload';
import { useShopId } from './use-shop-id';

/** The board's columns, from the first step to the last. Closed orders get one column at the end. */
const columns: { title: string; statuses: OrderStatus[] }[] = [
  { title: 'Waiting for payment', statuses: ['quoting', 'awaiting_payment'] },
  { title: 'Checking payment', statuses: ['verifying', 'needs_review'] },
  { title: 'Paid', statuses: ['paid', 'ready_for_pickup'] },
  { title: 'Delivering', statuses: ['dispatching', 'assigned', 'out_for_delivery'] },
  { title: 'Done', statuses: ['delivered'] },
  { title: 'Closed', statuses: ['expired', 'cancelled', 'payment_rejected'] },
];

export default function OrdersScreen() {
  const shopId = useShopId();
  const orders = useOrders(shopId);
  useLiveReload(shopId, 'orders');

  return (
    <QueryView query={orders}>
      {(list) =>
        list.length === 0 ? (
          <EmptyState title="No orders yet · ገና ትዕዛዝ የለም">
            Orders appear here live when customers buy from your channel posts.
          </EmptyState>
        ) : (
          <div className="flex flex-col gap-6">
            {columns.map((column) => {
              const inColumn = list.filter((order) => column.statuses.includes(order.status));
              if (inColumn.length === 0) return null;
              return (
                <section
                  key={column.title}
                  aria-label={column.title}
                  className="flex flex-col gap-2"
                >
                  <h2 className="text-sm font-semibold text-muted-foreground">
                    {column.title} ({inColumn.length})
                  </h2>
                  {inColumn.map((order) => (
                    <OrderCard key={order.id} order={order} />
                  ))}
                </section>
              );
            })}
          </div>
        )
      }
    </QueryView>
  );
}

function OrderCard({ order }: { order: OrderBoardItem }) {
  return (
    <Card className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium">{order.customerName}</p>
          <p className="text-xs text-muted-foreground">
            #{order.id.slice(0, 8)} · {formatTime(order.createdAt)}
          </p>
        </div>
        <Badge tone={order.status === 'needs_review' ? 'warning' : 'neutral'}>
          {statusLabels[order.status]}
        </Badge>
      </div>
      <ul className="text-sm">
        {order.lines.map((line) => (
          <li key={`${line.title}-${line.size}`}>
            {line.quantity} × {line.title} · size {line.size}
          </li>
        ))}
      </ul>
      <p className="text-sm">
        <span className="font-semibold">{formatBirr(order.total)}</span>
        <span className="text-muted-foreground"> · {deliveryLabels[order.deliveryType]}</span>
        {order.status === 'awaiting_payment' && order.paymentDeadline && (
          <span className="text-muted-foreground">
            {' '}
            · pay by {formatTime(order.paymentDeadline)}
          </span>
        )}
      </p>
    </Card>
  );
}
