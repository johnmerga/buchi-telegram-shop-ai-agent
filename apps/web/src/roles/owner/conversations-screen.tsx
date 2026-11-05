import type { ConversationItem } from '@buchi/shared';
import { QueryView } from '../../components/query-view';
import { EmptyState } from '../../components/screen-state';
import { Alert } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { formatTime } from '../../lib/labels';
import { useConversations, useSwitchConversation } from './review-api';
import { useShopId } from './use-shop-id';

/** Customer chats, with the same **Take over** and **Hand back** as the Telegram chat. */
export default function ConversationsScreen() {
  const shopId = useShopId();
  const conversations = useConversations(shopId);
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Conversations · ውይይቶች</h2>
      <p className="text-sm text-muted-foreground">
        While you answer a chat, Buchi stays quiet and relays the customer to your Telegram. It
        answers again when you hand back or after two hours without your reply.
      </p>
      <QueryView query={conversations}>
        {(items) =>
          items.length === 0 ? (
            <EmptyState title="No chats yet · ገና ውይይት የለም" />
          ) : (
            items.map((item) => (
              <ConversationCard key={item.id} shopId={shopId} conversation={item} />
            ))
          )
        }
      </QueryView>
    </div>
  );
}

function ConversationCard({
  shopId,
  conversation,
}: {
  shopId: string;
  conversation: ConversationItem;
}) {
  const switchMode = useSwitchConversation(shopId);
  const human = conversation.mode === 'human';
  return (
    <Card aria-label={`Chat with ${conversation.customerName}`} className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium">{conversation.customerName}</p>
          <p className="text-xs text-muted-foreground">{formatTime(conversation.updatedAt)}</p>
        </div>
        <Badge tone={human ? 'primary' : 'neutral'}>{human ? 'You answer' : 'Buchi answers'}</Badge>
      </div>
      {conversation.lastTurns.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm">
          {conversation.lastTurns.map((turn) => (
            <li key={`${turn.at}-${turn.role}-${turn.text}`}>
              <span className="font-medium">
                {turn.role === 'customer' ? conversation.customerName : 'Buchi'}:
              </span>{' '}
              {turn.text}
            </li>
          ))}
        </ul>
      )}
      {human && conversation.handBackAt && (
        <p className="text-xs text-muted-foreground">
          Buchi takes over again at {formatTime(conversation.handBackAt)} unless you reply.
        </p>
      )}
      {switchMode.isError && <Alert tone="error">{switchMode.error.message}</Alert>}
      <Button
        variant={human ? 'outline' : 'default'}
        disabled={switchMode.isPending}
        onClick={() => {
          switchMode.mutate({
            conversationId: conversation.id,
            to: human ? 'hand-back' : 'take-over',
          });
        }}
      >
        {human ? 'Hand back · መልስ' : 'Take over · ተረከብ'}
      </Button>
    </Card>
  );
}
