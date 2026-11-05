import { z } from 'zod';

const bilingual = (max: number) =>
  z.object({ en: z.string().trim().min(2).max(max), am: z.string().trim().min(2).max(max) });

/** The model's draft from the owner's photo and note. It has no price field on purpose. */
export const listingDraftSchema = z.object({
  title: bilingual(60),
  description: bilingual(400),
  category: z.string().trim().min(2).max(40),
  colors: z.array(z.string().trim().min(1).max(30)).max(4),
  sizes: z.array(z.string().trim().min(1).max(20)).min(1).max(30),
});
export type ListingDraft = z.output<typeof listingDraftSchema>;

const PREFIX = 'listing';
const actions = ['post', 'edit', 'discard'] as const;
type ListingAction = (typeof actions)[number];

/** Telegram limits callback data to 64 bytes, so a button carries only the draft's ID. */
export function listingCallbackData(action: ListingAction, draftId: string): string {
  return `${PREFIX}:${action}:${draftId}`;
}

export const listingCallbackSchema = z
  .string()
  .transform((data) => {
    const [prefix, action, draftId] = data.split(':');
    return { prefix, action, draftId };
  })
  .pipe(z.object({ prefix: z.literal(PREFIX), action: z.enum(actions), draftId: z.uuid() }));
