import { formatBirr, type PaymentDecisionItem } from '@buchi/shared';
import { QueryView } from '../../components/query-view';
import { Badge } from '../../components/ui/badge';
import { Card } from '../../components/ui/card';
import { useT, type MessageKey } from '../../lib/i18n';
import { usePaymentDecisions } from './review-api';

const deciders: Record<PaymentDecisionItem['decidedBy'], MessageKey> = {
  buchi: 'decisions.byBuchi',
  owner: 'decisions.byYou',
};

/** Payments that Buchi or the owner already settled, newest first, so a decision stays visible. */
export function PaymentDecisions({ shopId }: { shopId: string }) {
  const decisions = usePaymentDecisions(shopId);
  const { t } = useT();
  return (
    <section aria-label={t('decisions.title')} className="flex flex-col gap-2">
      <h3 className="font-semibold">{t('decisions.title')}</h3>
      <QueryView query={decisions}>
        {(items) =>
          items.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('decisions.empty')}</p>
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
  const { t, formatTime } = useT();
  const paid = [
    item.amount === null ? t('decisions.amountUnread') : formatBirr(item.amount),
    item.provider === null ? null : t(`provider.${item.provider}`),
    item.bankCheck === null ? null : t('decisions.bankPage', { result: item.bankCheck }),
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
          {t(`outcome.${item.outcome}`)}
        </Badge>
      </div>
      <p>{paid.join(' · ')}</p>
      <p className="text-muted-foreground">
        {t('decisions.decidedBy', { who: t(deciders[item.decidedBy]) })}
        {item.reasons.length > 0 && ` · ${item.reasons.join(', ')}`}
      </p>
    </Card>
  );
}
