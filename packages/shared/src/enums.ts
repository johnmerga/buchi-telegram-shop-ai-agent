import { z } from 'zod';

/** Order states from the state machine in docs/SOLUTION_DESIGN.md (Key workflows). */
export const orderStatuses = [
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
] as const;
export const orderStatusSchema = z.enum(orderStatuses);
export type OrderStatus = z.infer<typeof orderStatusSchema>;

export const deliveryTypes = ['free', 'express', 'saver', 'far', 'pickup'] as const;
export const deliveryTypeSchema = z.enum(deliveryTypes);
export type DeliveryType = z.infer<typeof deliveryTypeSchema>;

export const pricingModes = ['fixed', 'negotiable'] as const;
export const pricingModeSchema = z.enum(pricingModes);
export type PricingMode = z.infer<typeof pricingModeSchema>;

/** Actions at the "code only" level have no agent tool, so they need no value here. */
export const autonomyLevels = ['automatic', 'owner_confirms'] as const;
export const autonomyLevelSchema = z.enum(autonomyLevels);
export type AutonomyLevel = z.infer<typeof autonomyLevelSchema>;

export const actorRoles = ['customer', 'driver', 'owner'] as const;
export const actorRoleSchema = z.enum(actorRoles);
export type ActorRole = z.infer<typeof actorRoleSchema>;

/** The three agents. Each has its own prompt and its own tools. */
export const agentNames = ['sales', 'operations', 'owner_assistant'] as const;
export type AgentName = (typeof agentNames)[number];
