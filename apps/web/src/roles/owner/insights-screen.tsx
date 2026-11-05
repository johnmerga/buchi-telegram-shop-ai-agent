import { formatBirr, type Insights, type Rate } from '@buchi/shared';
import type { ReactNode } from 'react';
import { QueryView } from '../../components/query-view';
import { Card } from '../../components/ui/card';
import { formatTime } from '../../lib/labels';
import { useInsights } from './dashboard-api';
import { useShopId } from './use-shop-id';

/** The design doc's success metrics, where Buchi records what they need. */
export default function InsightsScreen() {
  const shopId = useShopId();
  const insights = useInsights(shopId);
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Insights · ግንዛቤዎች</h2>
      <QueryView query={insights}>{(data) => <InsightTiles insights={data} />}</QueryView>
    </div>
  );
}

function InsightTiles({ insights }: { insights: Insights }) {
  const { guard, delivery } = insights;
  return (
    <>
      <p className="text-sm text-muted-foreground">The last {insights.days} days.</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Tile
          title="Payments approved without you"
          value={share(insights.autoApprovedPayments)}
          target="Target: at least 80%"
        >
          {insights.autoApprovedPayments.count} of {insights.autoApprovedPayments.total} approved
          payments
        </Tile>
        <Tile title="Fraud blocked" value={String(insights.fraudBlocked.count)}>
          Screenshots rejected, claiming {formatBirr(insights.fraudBlocked.amount)}
        </Tile>
        <Tile
          title="Far quotes with a driver in 10 minutes"
          value={share(insights.farQuotesDriverFound)}
          target="Target: at least 80%"
        >
          {insights.farQuotesDriverFound.count} of {insights.farQuotesDriverFound.total} quotes
          offered to drivers
        </Tile>
        <Tile title="Delivery cost" value={formatBirr(delivery.cost)}>
          {delivery.trips} trips · Saver routes saved {formatBirr(delivery.saverSavings)}
        </Tile>
        <Tile title="Policy guard" value={String(guard.rejected)} target="Blocked agent proposals">
          {guard.accepted} allowed · {guard.needsOwner} sent to you
        </Tile>
        <Tile
          title="First reply time"
          value={seconds(insights.firstReply.medianSeconds)}
          target="Target: under 10 seconds"
        >
          Median over {insights.firstReply.replies} customer messages Buchi answered
        </Tile>
      </div>
      <Card>
        <h3 className="mb-2 font-medium">Channel posts</h3>
        {insights.posts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No posts in your channel yet.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-muted-foreground">
              <tr>
                <th className="font-normal">Product</th>
                <th className="font-normal">Buy taps</th>
                <th className="font-normal">Paid orders</th>
              </tr>
            </thead>
            <tbody>
              {insights.posts.map((post) => (
                <tr key={post.postId}>
                  <td>
                    {post.productTitle}
                    <span className="block text-xs text-muted-foreground">
                      {formatTime(post.postedAt)}
                    </span>
                  </td>
                  <td>{post.taps}</td>
                  <td>{post.paidOrders}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}

function Tile({
  title,
  value,
  target,
  children,
}: {
  title: string;
  value: string;
  target?: string;
  children: ReactNode;
}) {
  return (
    <Card aria-label={title} className="flex flex-col gap-1">
      <h3 className="text-sm text-muted-foreground">{title}</h3>
      <p className="text-2xl font-semibold">{value}</p>
      <p className="text-sm">{children}</p>
      {target && <p className="text-xs text-muted-foreground">{target}</p>}
    </Card>
  );
}

function share(rate: Rate): string {
  return rate.total === 0 ? '—' : `${String(Math.round((rate.count / rate.total) * 100))}%`;
}

function seconds(median: number | null): string {
  return median === null ? '—' : `${String(Math.round(median * 10) / 10)} s`;
}
