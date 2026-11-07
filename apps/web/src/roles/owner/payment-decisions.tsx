import { formatBirr, type PaymentDecisionItem } from '@buchi/shared';
import { QueryView } from '../../components/query-view';
import { Badge } from '../../components/ui/badge';
import { Card } from '../../components/ui/card';
import { formatTime, paymentOutcomeLabels, providerLabels } from '../../lib/labels';
import { usePaymentDecisions } from './review-api';

const deciders: Record<PaymentDecisionItem['decidedBy'], string> = {
  buchi: 'Buchi, automatically',
  owner: 'You',
};

/** Payments that Buchi or the owner already settled, newest first, so a decision stays visible. */
export function PaymentDecisions({ shopId }: { shopId: string }) {
  const decisions = usePaymentDecisions(shopId);
  return (
    <section aria-label="Recent decisions" className="flex flex-col gap-2">
      <h3 className="font-semibold">Recent decisions · የቅርብ ውሳኔዎች</h3>
      <QueryView query={decisions}>
        {(items) =>
          items.length === 0 ? (
            <p className="text-sm text-muted-foreground">No payment has been decided yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {items.map((item) => (
                <li key={item.proofId}>
                  <DecisionRow item={item} />
                </li>
              ))}
            </ul>
          )
        }
      </QueryView>
    </section>
  );
}

function DecisionRow({ item }: { item: PaymentDecisionItem }) {
  const paid = [
    item.amount === null ? 'amount unread' : formatBirr(item.amount),
    item.provider === null ? null : providerLabels[item.provider],
    item.bankCheck === null ? null : `bank page: ${item.bankCheck}`,
  ].filter((part) => part !== null);
  return (
    <Card className="flex flex-col gap-1 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium">{item.customerName}</p>
          <p className="text-xs text-muted-foreground">
            {item.orderReference} · {formatTime(item.receivedAt)}
          </p>
        </div>
        <Badge tone={item.outcome === 'rejected' ? 'warning' : 'neutral'}>
          {paymentOutcomeLabels[item.outcome]}
        </Badge>
      </div>
      <p>{paid.join(' · ')}</p>
      <p className="text-muted-foreground">
        Decided by {deciders[item.decidedBy]}
        {item.reasons.length > 0 && ` · ${item.reasons.join(', ')}`}
      </p>
    </Card>
  );
}
