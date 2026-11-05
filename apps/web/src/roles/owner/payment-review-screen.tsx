import { formatBirr, type PaymentReviewItem, type ReceiptFields } from '@buchi/shared';
import { QueryView } from '../../components/query-view';
import { EmptyState } from '../../components/screen-state';
import { Alert } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { formatTime } from '../../lib/labels';
import { useDecidePayment, usePaymentReviews } from './review-api';
import { Screenshot } from './screenshot';
import { useLiveReload } from './use-live-reload';
import { useShopId } from './use-shop-id';

const fields: { key: keyof ReceiptFields; label: string }[] = [
  { key: 'provider', label: 'Provider' },
  { key: 'transactionRef', label: 'Transaction ref' },
  { key: 'amount', label: 'Amount' },
  { key: 'receiverName', label: 'Receiver' },
  { key: 'receiverAccount', label: 'Receiver account' },
  { key: 'payerName', label: 'Payer' },
  { key: 'payerAccount', label: 'Payer account' },
  { key: 'paidAt', label: 'Paid at' },
];

const ruleLabels: Record<string, string> = {
  r1: 'R1 readable',
  r2: 'R2 provider',
  r3: 'R3 amount',
  r4: 'R4 receiver',
  r5: 'R5 time',
  r6: 'R6 new reference',
};

/** Payment screenshots that Buchi could not decide, with everything it checked. */
export default function PaymentReviewScreen() {
  const shopId = useShopId();
  const reviews = usePaymentReviews(shopId);
  useLiveReload(shopId, 'payment-reviews');
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Payment review · የክፍያ ግምገማ</h2>
      <QueryView query={reviews}>
        {(items) =>
          items.length === 0 ? (
            <EmptyState title="Nothing to review · የሚገመገም የለም">
              Payments that Buchi cannot approve on its own appear here and in your chat.
            </EmptyState>
          ) : (
            items.map((item) => <ReviewCard key={item.proofId} shopId={shopId} item={item} />)
          )
        }
      </QueryView>
    </div>
  );
}

function ReviewCard({ shopId, item }: { shopId: string; item: PaymentReviewItem }) {
  const decide = useDecidePayment(shopId);
  return (
    <Card aria-label={`Payment of ${item.customerName}`} className="flex flex-col gap-3">
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
            <p className="text-muted-foreground">Buchi could not read this screenshot.</p>
          )}
          <ul aria-label="Rule results" className="flex flex-wrap gap-1">
            {Object.entries(item.rules).map(([rule, result]) => (
              <li key={rule}>
                <Badge tone={result === 'fail' || result === 'underpaid' ? 'warning' : 'neutral'}>
                  {ruleLabels[rule] ?? rule}: {result}
                </Badge>
              </li>
            ))}
          </ul>
          <p>
            <span className="text-muted-foreground">Bank page: </span>
            {item.bankCheck ?? 'not checked'}
          </p>
          {item.reasons.length > 0 && (
            <p>
              <span className="text-muted-foreground">Why it waits: </span>
              {item.reasons.join(', ')}
            </p>
          )}
          {item.payerHighRisk && (
            <Badge tone="warning">High risk: other shops flagged this payer</Badge>
          )}
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
          Approve · አጽድቅ
        </Button>
        <Button
          variant="destructive"
          disabled={decide.isPending}
          onClick={() => {
            decide.mutate({ proofId: item.proofId, action: 'reject' });
          }}
        >
          Reject · ውድቅ
        </Button>
      </div>
    </Card>
  );
}

function ExtractedFields({ extraction }: { extraction: ReceiptFields }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
      {fields.map(({ key, label }) => {
        const read = extraction[key];
        return (
          <div key={key} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
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
