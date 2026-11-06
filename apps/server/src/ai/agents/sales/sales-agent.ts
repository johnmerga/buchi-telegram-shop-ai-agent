import type { Logger } from 'pino';
import type { CustomerMemoryService } from '../../../modules/customers/customer-memory.service';
import type { CustomersService } from '../../../modules/customers/customers.service';
import { isForgetRequest } from '../../../modules/sales/sales.domain';
import type { ConversationService } from '../../../modules/owner/conversations.service';
import { salesPrompt } from '../../prompts/sales';
import type { AgentDefinition, AgentRuntime, RunResult } from '../../runtime';
import { failureOf } from '../../structured-output';
import { historyContents, replyLanguage } from './conversation.domain';
import { numbersIn, unverifiedPrices } from './reply-prices.domain';
import type { SalesContext } from './sales-context';

/** Negotiation needs judgment, so the sales agent uses the smart tier, as the design doc routes it. */
const salesAgent: AgentDefinition = {
  name: 'sales',
  prompt: salesPrompt,
  tier: 'smart',
  priority: 'customer',
};

type SalesOutcome = 'reply' | 'handed_to_owner' | 'unverified_price' | 'unavailable' | 'forgotten';

interface SalesAnswer {
  outcome: SalesOutcome;
  /** What the customer reads. Every text except a checked reply comes from code. */
  text: string;
}

interface Buyer {
  telegramUserId: number;
  name: string;
}

const replies = {
  unavailable:
    'ይቅርታ፣ አሁን መመለስ አልቻልኩም / Sorry, I cannot chat right now. The buttons on the product still work for buying, or try again in a while.',
  unverifiedPrice:
    'ይቅርታ፣ ዋጋውን ላረጋግጥ / Sorry, let me check that price. Please ask me again in a moment.',
  handedToOwner: '🙋 የሱቁ ባለቤት እዚህ ይመልሱልዎታል / The shop owner will answer you here soon.',
  forgotten: '✅ የእርስዎን መረጃ ረስቻለሁ / Done, I have forgotten your saved details.',
};

const escalationReasons: Record<Extract<RunResult, { outcome: 'escalated' }>['reason'], string> = {
  guard_rejections: 'Buchi could not agree a price within your limits.',
  step_limit: 'Buchi could not finish answering this customer.',
  empty_reply: 'Buchi could not answer this customer.',
};

/**
 * Answers a customer's free-text message with the sales agent. Code keeps the last word: a reply
 * that names a price no trusted source gave is replaced, an escalation goes to the owner, and a
 * model failure gets a short message that points to the buttons, which work without the model.
 */
export class SalesAgent {
  constructor(
    private readonly runtime: Pick<AgentRuntime, 'run'>,
    private readonly context: Pick<SalesContext, 'build'>,
    private readonly customers: Pick<CustomersService, 'identify'>,
    private readonly conversations: Pick<
      ConversationService,
      | 'recentTurns'
      | 'recordTurns'
      | 'forgetTurns'
      | 'humanConversation'
      | 'requestHuman'
      | 'relayFromCustomer'
    >,
    private readonly memory: Pick<CustomerMemoryService, 'forget'>,
    private readonly logger: Logger,
  ) {}

  async answer(shopId: string, buyer: Buyer, message: string): Promise<SalesAnswer> {
    const customer = await this.customers.identify(shopId, buyer.telegramUserId, buyer.name);
    if (isForgetRequest(message)) {
      await this.memory.forget(shopId, customer.id);
      await this.conversations.forgetTurns(shopId, buyer);
      return { outcome: 'forgotten', text: replies.forgotten };
    }

    const history = await this.conversations.recentTurns(shopId, buyer);
    // Recorded before the run, so a fact the agent saves can cite this message as its source.
    await this.conversations.recordTurns(shopId, buyer, [{ role: 'customer', text: message }]);
    const context = await this.context.build(shopId, customer);
    const turnContext = [context.text, replyLanguage(message)].filter(Boolean).join('\n');

    let result: RunResult;
    try {
      result = await this.runtime.run(salesAgent, {
        shopId,
        actor: { kind: 'telegram_user', telegramUserId: buyer.telegramUserId },
        history: [
          ...historyContents(history),
          { role: 'user', parts: [{ text: turnContext }, { text: message }] },
        ],
      });
    } catch (err) {
      this.logger.warn({ shopId, failure: failureOf(err) }, 'sales agent unavailable');
      return this.say(shopId, buyer, 'unavailable', replies.unavailable);
    }

    if (result.outcome === 'escalated') {
      await this.conversations.requestHuman(shopId, buyer, escalationReasons[result.reason]);
      return this.handedToOwner(shopId, buyer, message);
    }
    if (await this.conversations.humanConversation(shopId, buyer.telegramUserId)) {
      return this.handedToOwner(shopId, buyer, message);
    }

    const trusted = [
      ...context.prices.flatMap(numbersIn),
      ...numbersIn(JSON.stringify(result.toolResults)),
      ...history.filter((turn) => turn.role === 'buchi').flatMap((turn) => numbersIn(turn.text)),
    ];
    if (unverifiedPrices(result.text, trusted).length > 0) {
      this.logger.warn({ shopId, runId: result.runId }, 'reply named a price no tool gave');
      return this.say(shopId, buyer, 'unverified_price', replies.unverifiedPrice);
    }
    return this.say(shopId, buyer, 'reply', result.text);
  }

  /** The owner sees the message that led here and can reply to it. */
  private async handedToOwner(shopId: string, buyer: Buyer, message: string) {
    const conversation = await this.conversations.humanConversation(shopId, buyer.telegramUserId);
    if (conversation) await this.conversations.relayFromCustomer(conversation, { text: message });
    return this.say(shopId, buyer, 'handed_to_owner', replies.handedToOwner);
  }

  private async say(
    shopId: string,
    buyer: Buyer,
    outcome: SalesOutcome,
    text: string,
  ): Promise<SalesAnswer> {
    await this.conversations.recordTurns(shopId, buyer, [{ role: 'buchi', text }]);
    return { outcome, text };
  }
}
