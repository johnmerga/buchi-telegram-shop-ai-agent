import { formatBirr, type PaymentReviewItem, type ReceiptFields } from '@buchi/shared';
import { QueryView } from '../../components/query-view';
import { EmptyState } from '../../components/screen-state';
import { Alert } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { PaymentsIcon } from '../../components/icons';
import { useT, type MessageKey } from '../../lib/i18n';
import { PaymentDecisions } from './payment-decisions';
import { useDecidePayment, usePaymentReviews } from './review-api';
import { Screenshot } from './screenshot';
import { useLiveReload } from './use-live-reload';
import { useShopId } from './use-shop-id';

const fields: { key: keyof ReceiptFields; label: MessageKey }[] = [
  { key: 'layout', label: 'review.field.layout' },
  { key: 'transactionRef', label: 'review.field.transactionRef' },
  { key: 'amount', label: 'review.field.amount' },
  { key: 'receiverName', label: 'review.field.receiver' },
  { key: 'receiverAccount', label: 'review.field.receiverAccount' },
  { key: 'payerName', label: 'review.field.payer' },
  { key: 'payerAccount', label: 'review.field.payerAccount' },
  { key: 'paidAt', label: 'review.field.paidAt' },
  { key: 'status', label: 'review.field.status' },
];

const ruleLabels: Record<string, MessageKey> = {
  r1: 'review.rule.r1',
  r2: 'review.rule.r2',
  r3: 'review.rule.r3',
  r4: 'review.rule.r4',
  r5: 'review.rule.r5',
  r6: 'review.rule.r6',
};

/** Payment screenshots that Buchi could not decide, with everything it checked, then the history. */
export default function PaymentReviewScreen() {
  const shopId = useShopId();
  const reviews = usePaymentReviews(shopId);
  const { t } = useT();
  useLiveReload(shopId, 'payment-reviews');
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">{t('review.title')}</h2>
      <QueryView query={reviews}>
        {(items) =>
          items.length === 0 ? (
            <EmptyState title={t('review.empty')} icon={<PaymentsIcon />}>
              {t('review.emptyHint')}
            </EmptyState>
          ) : (
            items.map((item) => <ReviewCard key={item.proofId} shopId={shopId} item={item} />)
          )
        }
      </QueryView>
      <PaymentDecisions shopId={shopId} />
    </div>
  );
}

function ReviewCard({ shopId, item }: { shopId: string; item: PaymentReviewItem }) {
  const decide = useDecidePayment(shopId);
  const { t, formatTime } = useT();
  return (
    <Card
      aria-label={t('review.paymentOf', { name: item.customerName })}
      className="flex flex-col gap-3"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium">{item.customerName}</p>
          <p className="text-xs text-muted-foreground">
            {item.orderReference} · {formatTime(item.receivedAt)}
          </p>
        </div>
        <p className="font-semibold">{formatBirr(item.orderTotal)}</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Screenshot shopId={shopId} proofId={item.proofId} />
        <div className="flex flex-col gap-3 text-sm">
          {item.extraction ? (
            <ExtractedFields extraction={item.extraction} />
          ) : (
            <p className="text-muted-foreground">{t('review.unread')}</p>
          )}
          <ul aria-label={t('review.rules')} className="flex flex-wrap gap-1">
            {Object.entries(item.rules).map(([rule, result]) => (
              <li key={rule}>
                <Badge tone={result === 'fail' || result === 'underpaid' ? 'warning' : 'neutral'}>
                  {ruleLabels[rule] ? t(ruleLabels[rule]) : rule}: {result}
                </Badge>
              </li>
            ))}
          </ul>
          <p>
            <span className="text-muted-foreground">{t('review.bankPage')} </span>
            {item.bankCheck ?? t('review.notChecked')}
          </p>
          {item.reasons.length > 0 && (
            <p>
              <span className="text-muted-foreground">{t('review.whyWaits')} </span>
              {item.reasons.join(', ')}
            </p>
          )}
          {item.customerReported && <Badge tone="warning">{t('review.reported')}</Badge>}
          {item.payerHighRisk && <Badge tone="warning">{t('review.highRisk')}</Badge>}
        </div>
      </div>
      {decide.isError && <Alert tone="error">{decide.error.message}</Alert>}
      <div className="grid grid-cols-2 gap-2">
        <Button
          disabled={decide.isPending}
          onClick={() => {
            decide.mutate({ proofId: item.proofId, action: 'approve' });
          }}
        >
          {t('review.approve')}
        </Button>
        <Button
          variant="destructive"
          disabled={decide.isPending}
          onClick={() => {
            decide.mutate({ proofId: item.proofId, action: 'reject' });
          }}
        >
          {t('review.reject')}
        </Button>
      </div>
    </Card>
  );
}

function ExtractedFields({ extraction }: { extraction: ReceiptFields }) {
  const { t } = useT();
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
      {fields.map(({ key, label }) => {
        const read = extraction[key];
        return (
          <div key={key} className="contents">
            <dt className="text-muted-foreground">{t(label)}</dt>
            <dd>
              {read.value ?? '—'}
              {read.value !== null && (
                <span className="text-xs text-muted-foreground">
                  {' '}
                  ({Math.round(read.confidence * 100)}%)
                </span>
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
