import { z } from 'zod';

/** Order states from the state machine in docs/SOLUTION_DESIGN.md (Key workflows). */
export const orderStatusSchema = z.enum([
  'quoting',
  'awaiting_payment',
  'verifying',
  'paid',
  'needs_review',
  'dispatching',
  'assigned',
  'out_for_delivery',
  'ready_for_pickup',
  'delivered',
  'expired',
  'cancelled',
]);
export type OrderStatus = z.infer<typeof orderStatusSchema>;

export const deliveryTypeSchema = z.enum(['free', 'express', 'saver', 'far', 'pickup']);
export type DeliveryType = z.infer<typeof deliveryTypeSchema>;

export const pricingModeSchema = z.enum(['fixed', 'negotiable']);
export type PricingMode = z.infer<typeof pricingModeSchema>;

/** Actions at the "code only" level have no agent tool, so they need no value here. */
export const autonomyLevelSchema = z.enum(['automatic', 'owner_confirms']);
export type AutonomyLevel = z.infer<typeof autonomyLevelSchema>;

export const actorRoleSchema = z.enum(['customer', 'driver', 'owner']);
export type ActorRole = z.infer<typeof actorRoleSchema>;
