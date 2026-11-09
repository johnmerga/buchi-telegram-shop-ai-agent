import { formatBirr, type Insights, type Rate } from '@buchi/shared';
import type { ReactNode } from 'react';
import { QueryView } from '../../components/query-view';
import { Card } from '../../components/ui/card';
import { useT } from '../../lib/i18n';
import { useInsights } from './dashboard-api';
import { useShopId } from './use-shop-id';

/** The design doc's success metrics, where Buchi records what they need. */
export default function InsightsScreen() {
  const shopId = useShopId();
  const insights = useInsights(shopId);
  const { t } = useT();
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">{t('nav.insights')}</h2>
      <QueryView query={insights}>{(data) => <InsightTiles insights={data} />}</QueryView>
    </div>
  );
}

function InsightTiles({ insights }: { insights: Insights }) {
  const { guard, delivery } = insights;
  const { t, formatTime } = useT();
  const target80 = t('insights.target80');
  return (
    <>
      <p className="text-sm text-muted-foreground">{t('insights.days', { days: insights.days })}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Tile
          title={t('insights.autoApproved')}
          value={share(insights.autoApprovedPayments)}
          target={target80}
          tone="primary"
        >
          {t('insights.autoApprovedDetail', {
            count: insights.autoApprovedPayments.count,
            total: insights.autoApprovedPayments.total,
          })}
        </Tile>
        <Tile title={t('insights.fraud')} value={String(insights.fraudBlocked.count)}>
          {t('insights.fraudDetail', { amount: formatBirr(insights.fraudBlocked.amount) })}
        </Tile>
        <Tile
          title={t('insights.farQuotes')}
          value={share(insights.farQuotesDriverFound)}
          target={target80}
        >
          {t('insights.farQuotesDetail', {
            count: insights.farQuotesDriverFound.count,
            total: insights.farQuotesDriverFound.total,
          })}
        </Tile>
        <Tile title={t('insights.deliveryCost')} value={formatBirr(delivery.cost)}>
          {t('insights.deliveryCostDetail', {
            trips: delivery.trips,
            saved: formatBirr(delivery.saverSavings),
          })}
        </Tile>
        <Tile
          title={t('insights.guard')}
          value={String(guard.rejected)}
          target={t('insights.guardTarget')}
        >
          {t('insights.guardDetail', { allowed: guard.accepted, owner: guard.needsOwner })}
        </Tile>
        <Tile
          title={t('insights.firstReply')}
          value={seconds(insights.firstReply.medianSeconds)}
          target={t('insights.firstReplyTarget')}
        >
          {t('insights.firstReplyDetail', { count: insights.firstReply.replies })}
        </Tile>
      </div>
      <Card>
        <h3 className="mb-2 font-medium">{t('insights.posts')}</h3>
        {insights.posts.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('insights.noPosts')}</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-muted-foreground">
              <tr>
                <th className="py-1 font-normal">{t('insights.product')}</th>
                <th className="py-1 font-normal">{t('insights.taps')}</th>
                <th className="py-1 font-normal">{t('insights.paidOrders')}</th>
              </tr>
            </thead>
            <tbody>
              {insights.posts.map((post) => (
                <tr key={post.postId} className="border-t border-border">
                  <td className="py-2">
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
  tone,
  children,
}: {
  title: string;
  value: string;
  target?: string;
  tone?: 'primary';
  children: ReactNode;
}) {
  return (
    <Card aria-label={title} className="flex flex-col gap-1">
      <h3 className="text-sm text-muted-foreground">{title}</h3>
      <p
        className={
          tone === 'primary' ? 'text-3xl font-semibold text-primary' : 'text-3xl font-semibold'
        }
      >
        {value}
      </p>
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
