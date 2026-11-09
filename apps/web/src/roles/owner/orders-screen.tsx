import { formatBirr, type OrderBoardItem, type OrderStatus } from '@buchi/shared';
import { QueryView } from '../../components/query-view';
import { EmptyState } from '../../components/screen-state';
import { Badge } from '../../components/ui/badge';
import { Card } from '../../components/ui/card';
import { OrdersIcon } from '../../components/icons';
import { useT, type MessageKey } from '../../lib/i18n';
import { useOrders } from './owner-api';
import { useLiveReload } from './use-live-reload';
import { useShopId } from './use-shop-id';

/** The board's columns, from the first step to the last. Closed orders get one column at the end. */
const columns: { title: MessageKey; statuses: OrderStatus[] }[] = [
  { title: 'orders.waiting', statuses: ['quoting', 'awaiting_payment'] },
  { title: 'orders.checking', statuses: ['verifying', 'needs_review'] },
  { title: 'orders.paid', statuses: ['paid', 'ready_for_pickup'] },
  { title: 'orders.delivering', statuses: ['dispatching', 'assigned', 'out_for_delivery'] },
  { title: 'orders.done', statuses: ['delivered'] },
  { title: 'orders.closed', statuses: ['expired', 'cancelled', 'payment_rejected'] },
];

export default function OrdersScreen() {
  const shopId = useShopId();
  const orders = useOrders(shopId);
  const { t } = useT();
  useLiveReload(shopId, 'orders');

  return (
    <QueryView query={orders}>
      {(list) =>
        list.length === 0 ? (
          <EmptyState title={t('orders.empty')} icon={<OrdersIcon />}>
            {t('orders.emptyHint')}
          </EmptyState>
        ) : (
          <div className="flex flex-col gap-6">
            <h2 className="text-lg font-semibold">{t('nav.orders')}</h2>
            {columns.map((column) => {
              const inColumn = list.filter((order) => column.statuses.includes(order.status));
              if (inColumn.length === 0) return null;
              return (
                <section
                  key={column.title}
                  aria-label={t(column.title)}
                  className="flex flex-col gap-2"
                >
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                    {t(column.title)}
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
                      {inColumn.length}
                    </span>
                  </h3>
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
  const { t, formatTime } = useT();
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
          {t(`status.${order.status}`)}
        </Badge>
      </div>
      <ul className="text-sm">
        {order.lines.map((line) => (
          <li key={`${line.title}-${line.size}`}>
            {line.quantity} × {line.title} · {t('orders.size', { size: line.size })}
          </li>
        ))}
      </ul>
      <p className="text-sm">
        <span className="font-semibold">{formatBirr(order.total)}</span>
        <span className="text-muted-foreground"> · {t(`delivery.${order.deliveryType}`)}</span>
        {order.status === 'awaiting_payment' && order.paymentDeadline && (
          <span className="text-muted-foreground">
            {' '}
            · {t('orders.payBy', { time: formatTime(order.paymentDeadline) })}
          </span>
        )}
      </p>
    </Card>
  );
}
