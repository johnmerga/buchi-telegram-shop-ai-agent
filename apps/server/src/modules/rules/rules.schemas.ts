import { deliverySettingsSchema } from '@buchi/shared';
import { z } from 'zod';
import { pausePeriod } from './rules.domain';

const dateSchema = z.iso.date().describe('A date in Addis Ababa, as YYYY-MM-DD.');

const timeOfDaySchema = z
  .object({
    clock: z
      .enum(['ethiopian', 'western'])
      .describe(
        'ethiopian when the owner counts hours the Ethiopian way, as in "10 ሰዓት"; western for ' +
          '24-hour or AM/PM times, as in "4 PM" or "16:00".',
      ),
    hour: z
      .number()
      .int()
      .min(0)
      .max(23)
      .describe('1 to 12 on the Ethiopian clock, 0 to 23 on the western.'),
    minute: z.number().int().min(0).max(59).default(0),
    period: z
      .enum(['morning', 'afternoon', 'evening', 'night'])
      .optional()
      .describe(
        'Only for the Ethiopian clock, when the owner names the part of the day: ጠዋት morning, ' +
          'ከሰዓት or ከቀኑ afternoon, ማታ or ምሽት evening, ሌሊት night.',
      ),
  })
  .refine((time) => time.clock === 'western' || (time.hour >= 1 && time.hour <= 12), {
    message: 'An Ethiopian hour is from 1 to 12.',
    path: ['hour'],
    abort: true,
  })
  .refine((time) => time.clock === 'ethiopian' || time.period === undefined, {
    message: 'A part of the day is only for the Ethiopian clock.',
    path: ['period'],
  });
export type TimeOfDay = z.output<typeof timeOfDaySchema>;

const deliveryPauseFields = z.object({
  date: dateSchema.describe('The day the pause starts.'),
  from: timeOfDaySchema
    .optional()
    .describe('When the pause starts. Omit for the start of the day.'),
  untilDate: dateSchema.optional().describe('The day the pause ends. Omit for the same day.'),
  until: timeOfDaySchema
    .optional()
    .describe('When deliveries start again. Omit for the end of the day.'),
});
export type DeliveryPauseProposal = z.output<typeof deliveryPauseFields>;

const deliveryPauseSchema = deliveryPauseFields.refine((pause) => {
  const { startsAt, endsAt } = pausePeriod(pause);
  return endsAt > startsAt;
}, 'The pause must end after it starts.');

export const promotionParametersSchema = z.object({
  percentOff: z.number().int().min(1).max(90),
  keywords: z
    .array(z.string().trim().min(2).max(40))
    .max(10)
    .describe(
      'Words that a product title or description contains, in English and Amharic, such as ' +
        '["sneaker", "ስኒከር"]. An empty list means every product.',
    ),
});
export type PromotionParameters = z.output<typeof promotionParametersSchema>;

const promotionFields = promotionParametersSchema.extend({
  startDate: dateSchema.describe('The first day of the promotion.'),
  endDate: dateSchema.describe('The last day of the promotion, included.'),
});
export type PromotionProposal = z.output<typeof promotionFields>;

// ISO dates compare correctly as text.
const promotionSchema = promotionFields.refine(
  (promotion) => promotion.endDate >= promotion.startDate,
  'The last day cannot be before the first day.',
);

/** The owner's settings with only the fields that change. Saving checks the whole result. */
export const settingsChangeSchema = z
  .object(deliverySettingsSchema.shape)
  .partial()
  .refine((change) => Object.keys(change).length > 0, 'Change at least one setting.');

const ruleTypes = ['delivery_pause', 'promotion', 'delivery_settings'] as const;
export type RuleType = (typeof ruleTypes)[number];

/**
 * A rule the owner assistant proposes from an owner's words. One section per type, so the model
 * fills plain objects instead of a union. Code turns it into exact times and checks.
 */
export const ruleProposalSchema = z
  .object({
    type: z.enum(ruleTypes),
    deliveryPause: deliveryPauseSchema.optional(),
    promotion: promotionSchema.optional(),
    deliverySettings: settingsChangeSchema.optional(),
  })
  .refine(
    (rule) =>
      (rule.type === 'delivery_pause') === (rule.deliveryPause !== undefined) &&
      (rule.type === 'promotion') === (rule.promotion !== undefined) &&
      (rule.type === 'delivery_settings') === (rule.deliverySettings !== undefined),
    'Fill exactly the section that matches the type.',
  );
export type RuleProposal = z.output<typeof ruleProposalSchema>;
