import type { AiDecision } from '@buchi/shared';
import { QueryView } from '../../components/query-view';
import { EmptyState } from '../../components/screen-state';
import { Alert } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { formatTime } from '../../lib/labels';
import { useAiDecisions, useDecideAi } from './review-api';
import { useShopId } from './use-shop-id';

const resultLabels: Record<AiDecision['result'], string> = {
  accepted: 'Allowed',
  rejected: 'Blocked',
  needs_owner: 'Needs you',
};

const statusLabels: Record<NonNullable<AiDecision['ownerStatus']>, string> = {
  pending: 'Waiting for you',
  approved: 'You approved',
  declined: 'You declined',
};

/** Every value an agent proposed, what the policy guard decided, and why. */
export default function AiDecisionsScreen() {
  const shopId = useShopId();
  const decisions = useAiDecisions(shopId);
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">AI decisions · የAI ውሳኔዎች</h2>
      <QueryView query={decisions}>
        {(items) =>
          items.length === 0 ? (
            <EmptyState title="No decisions yet · ገና ውሳኔ የለም">
              Prices, deadline changes, and other actions that Buchi’s agents propose appear here.
            </EmptyState>
          ) : (
            items.map((item) => <DecisionCard key={item.id} shopId={shopId} decision={item} />)
          )
        }
      </QueryView>
    </div>
  );
}

function DecisionCard({ shopId, decision }: { shopId: string; decision: AiDecision }) {
  const decide = useDecideAi(shopId);
  return (
    <Card aria-label={`Decision ${decision.tool}`} className="flex flex-col gap-2 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium">{decision.tool}</p>
          <p className="text-xs text-muted-foreground">
            {decision.agent} agent · {formatTime(decision.createdAt)}
          </p>
        </div>
        <Badge tone={decision.result === 'accepted' ? 'neutral' : 'warning'}>
          {resultLabels[decision.result]}
        </Badge>
      </div>
      <Values label="Proposed" values={decision.proposed} />
      {decision.limits && <Values label="Your limits" values={decision.limits} />}
      <p>
        <span className="text-muted-foreground">Guard reason: </span>
        {decision.reason}
        {decision.counteroffer !== null && ` · counteroffer ${String(decision.counteroffer)}`}
      </p>
      {decision.agentReason && (
        <p>
          <span className="text-muted-foreground">Agent’s reason: </span>
          {decision.agentReason}
        </p>
      )}
      {decision.evidenceIds.length > 0 && (
        <p className="text-xs text-muted-foreground">Evidence: {decision.evidenceIds.join(', ')}</p>
      )}
      {decision.ownerStatus && (
        <p className="font-medium">
          {statusLabels[decision.ownerStatus]}
          {decision.decidedAt && ` · ${formatTime(decision.decidedAt)}`}
        </p>
      )}
      {decision.ownerStatus === 'pending' && !decision.ownerCanDecide && (
        <Alert tone="info">Answer this with its buttons in your Telegram chat.</Alert>
      )}
      {decide.data?.error && <Alert tone="error">Approved, but: {decide.data.error}</Alert>}
      {decide.data?.status === 'already_decided' && (
        <Alert tone="info">This was already decided.</Alert>
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
            Approve · አጽድቅ
          </Button>
          <Button
            variant="destructive"
            disabled={decide.isPending}
            onClick={() => {
              decide.mutate({ decisionId: decision.id, choice: 'decline' });
            }}
          >
            Decline · አትቀበል
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
