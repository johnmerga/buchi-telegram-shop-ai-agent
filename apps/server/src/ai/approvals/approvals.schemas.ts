import { z } from 'zod';

const PREFIX = 'approval';

export type ApprovalChoice = 'approve' | 'decline';

/** Telegram limits callback data to 64 bytes, so a button carries only the decision's ID. */
export function approvalCallbackData(choice: ApprovalChoice, decisionId: string): string {
  return `${PREFIX}:${choice}:${decisionId}`;
}

export const approvalCallbackSchema = z
  .string()
  .transform((data) => {
    const [prefix, choice, decisionId] = data.split(':');
    return { prefix, choice, decisionId };
  })
  .pipe(
    z.object({
      prefix: z.literal(PREFIX),
      choice: z.enum(['approve', 'decline']),
      decisionId: z.uuid(),
    }),
  );
