import { z } from 'zod';

/** The data of a **Take over** or **Hand back** button, as `modeButton` writes it. */
export const modeActionSchema = z
  .string()
  .transform((data) => {
    const [action, conversationId] = data.split(':');
    return { action, conversationId };
  })
  .pipe(z.object({ action: z.enum(['takeover', 'handback']), conversationId: z.uuid() }));
