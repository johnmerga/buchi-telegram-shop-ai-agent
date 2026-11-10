import type { AiDecision } from '@buchi/shared';
import { QueryView } from '../../components/query-view';
import { EmptyState } from '../../components/screen-state';
import { Alert } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { SparkIcon } from '../../components/icons';
import { useT, type MessageKey } from '../../lib/i18n';
import { useAiDecisions, useDecideAi } from './review-api';
import { useShopId } from './use-shop-id';

const resultLabels: Record<AiDecision['result'], MessageKey> = {
  accepted: 'ai.result.accepted',
  rejected: 'ai.result.rejected',
  needs_owner: 'ai.result.needsOwner',
};

const statusLabels: Record<NonNullable<AiDecision['ownerStatus']>, MessageKey> = {
  pending: 'ai.status.pending',
  approved: 'ai.status.approved',
  declined: 'ai.status.declined',
};

/** Every value an agent proposed, what the policy guard decided, and why. */
export default function AiDecisionsScreen() {
  const shopId = useShopId();
  const decisions = useAiDecisions(shopId);
  const { t } = useT();
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">{t('nav.aiDecisions')}</h2>
        <p className="text-sm text-muted-foreground">{t('ai.intro')}</p>
      </div>
      <QueryView query={decisions}>
        {(items) =>
          items.length === 0 ? (
            <EmptyState title={t('ai.empty')} icon={<SparkIcon />}>
              {t('ai.emptyHint')}
            </EmptyState>
          ) : (
            <>
              <WaitingNote count={items.filter((item) => item.ownerStatus === 'pending').length} />
              {items.map((item) => (
                <DecisionCard key={item.id} shopId={shopId} decision={item} />
              ))}
            </>
          )
        }
      </QueryView>
    </div>
  );
}

/** The list runs newest first, so decisions that wait for the owner are counted up here. */
function WaitingNote({ count }: { count: number }) {
  const { t } = useT();
  if (count === 0) return null;
  return <Alert tone="info">{t('ai.waiting', { count })}</Alert>;
}

function DecisionCard({ shopId, decision }: { shopId: string; decision: AiDecision }) {
  const decide = useDecideAi(shopId);
  const { t, formatTime } = useT();
  return (
    <Card
      aria-label={t('ai.decision', { tool: decision.tool })}
      className="flex flex-col gap-2 text-sm"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium">{decision.tool}</p>
          <p className="text-xs text-muted-foreground">
            {t(`agent.${decision.agent}`)} · {formatTime(decision.createdAt)}
          </p>
        </div>
        <Badge tone={decision.result === 'accepted' ? 'neutral' : 'warning'}>
          {t(resultLabels[decision.result])}
        </Badge>
      </div>
      <Values label={t('ai.proposed')} values={decision.proposed} />
      {decision.limits && <Values label={t('ai.limits')} values={decision.limits} />}
      <p>
        <span className="text-muted-foreground">{t('ai.guardReason')} </span>
        {decision.reason}
        {decision.counteroffer !== null &&
          ` · ${t('ai.counteroffer', { value: String(decision.counteroffer) })}`}
      </p>
      {decision.agentReason && (
        <p>
          <span className="text-muted-foreground">{t('ai.agentReason')} </span>
          {decision.agentReason}
        </p>
      )}
      {decision.evidenceIds.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {t('ai.evidence', { ids: decision.evidenceIds.join(', ') })}
        </p>
      )}
      {decision.ownerStatus && (
        <p className="font-medium">
          {t(statusLabels[decision.ownerStatus])}
          {decision.decidedAt && ` · ${formatTime(decision.decidedAt)}`}
        </p>
      )}
      {decision.ownerStatus === 'pending' && !decision.ownerCanDecide && (
        <Alert tone="info">{t('ai.answerInChat')}</Alert>
      )}
      {decide.data?.error && (
        <Alert tone="error">{t('ai.approvedBut', { error: decide.data.error })}</Alert>
      )}
      {decide.data?.status === 'already_decided' && (
        <Alert tone="info">{t('ai.alreadyDecided')}</Alert>
      )}
      {decide.isError && <Alert tone="error">{decide.error.message}</Alert>}
      {decision.ownerCanDecide && (
        <div className="grid grid-cols-2 gap-2">
          <Button
            disabled={decide.isPending}
            onClick={() => {
              decide.mutate({ decisionId: decision.id, choice: 'approve' });
            }}
          >
            {t('review.approve')}
          </Button>
          <Button
            variant="destructive"
            disabled={decide.isPending}
            onClick={() => {
              decide.mutate({ decisionId: decision.id, choice: 'decline' });
            }}
          >
            {t('ai.decline')}
          </Button>
        </div>
      )}
    </Card>
  );
}

function Values({ label, values }: { label: string; values: Record<string, unknown> }) {
  const entries = Object.entries(values);
  if (entries.length === 0) return null;
  return (
    <p>
      <span className="text-muted-foreground">{label}: </span>
      {entries.map(([key, value]) => `${key} ${JSON.stringify(value)}`).join(' · ')}
    </p>
  );
}
