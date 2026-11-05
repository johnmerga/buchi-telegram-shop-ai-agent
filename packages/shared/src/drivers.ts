import { z } from 'zod';
import { coordinatesSchema } from './geo';
import { moneySchema } from './money';

/**
 * A Telegram username such as "@abebe_rides". Telegram ignores case in usernames, so it is stored
 * in lowercase without the "@".
 */
export const driverInviteSchema = z.object({
  username: z
    .string()
    .trim()
    .regex(/^@?[A-Za-z][A-Za-z0-9_]{4,31}$/, 'Use a Telegram username such as @abebe_rides.')
    .transform((username) => username.replace(/^@/, '').toLowerCase()),
});
export type DriverInvite = z.infer<typeof driverInviteSchema>;

export const driverInviteLinkSchema = z.object({
  driverId: z.uuid(),
  link: z.url(),
  expiresAt: z.iso.datetime(),
});

/** A driver on the owner's list. `linked` turns true once the driver opens the invite link. */
export const driverListItemSchema = z.object({
  id: z.uuid(),
  username: z.string(),
  name: z.string().nullable(),
  linked: z.boolean(),
  available: z.boolean(),
  inviteExpiresAt: z.iso.datetime().nullable(),
});
export type DriverListItem = z.infer<typeof driverListItemSchema>;

/**
 * A job offered to the shop's drivers. `far` marks a far-area job under **Special offers**, which a
 * driver holds until the customer pays. `raised` marks an offer whose price went up since it opened.
 */
export const openOfferSchema = z.object({
  offerId: z.uuid(),
  shopName: z.string(),
  price: moneySchema,
  far: z.boolean(),
  raised: z.boolean(),
  stops: z.number().int().positive(),
  routeMeters: z.number().int(),
  estimatedMinutes: z.number().int(),
});
export type OpenOffer = z.infer<typeof openOfferSchema>;

/** A stop on an accepted trip. The customer's details appear only after the driver accepts. */
export const tripStopSchema = z.object({
  stopId: z.uuid(),
  position: z.number().int().positive(),
  customerName: z.string(),
  phone: z.string().nullable(),
  pin: coordinatesSchema,
  delivered: z.boolean(),
});
export type TripStop = z.infer<typeof tripStopSchema>;

export const tripSchema = z.object({
  jobId: z.uuid(),
  shopName: z.string(),
  shopPin: coordinatesSchema.nullable(),
  status: z.enum(['assigned', 'picked_up']),
  payout: moneySchema,
  stops: z.array(tripStopSchema),
});
export type Trip = z.infer<typeof tripSchema>;

/** What a shop owes the driver for delivered trips. Buchi does not record settlements yet. */
export const driverEarningsSchema = z.object({
  shopName: z.string(),
  deliveredTrips: z.number().int().min(0),
  payout: moneySchema,
});

export const driverBoardSchema = z.object({
  offers: z.array(openOfferSchema),
  /** Far-area jobs this driver holds while their customers decide and pay. */
  held: z.array(openOfferSchema),
  trips: z.array(tripSchema),
  earnings: z.array(driverEarningsSchema),
});
export type DriverBoard = z.infer<typeof driverBoardSchema>;

export const acceptResultSchema = z.object({ result: z.enum(['accepted', 'closed']) });

export const holdResultSchema = z.object({ result: z.enum(['held', 'closed']) });

/** A stop on the owner's deliveries map. The pin is null once the nightly job forgot it. */
export const deliveryMapStopSchema = z.object({
  orderId: z.uuid(),
  position: z.number().int().positive(),
  pin: coordinatesSchema.nullable(),
  delivered: z.boolean(),
});

/** An open delivery job: offered to drivers, or assigned and on its way. */
export const deliveryMapJobSchema = z.object({
  jobId: z.uuid(),
  status: z.enum(['offered', 'assigned', 'picked_up']),
  far: z.boolean(),
  payout: moneySchema,
  driverName: z.string().nullable(),
  stops: z.array(deliveryMapStopSchema),
});
export type DeliveryMapJob = z.infer<typeof deliveryMapJobSchema>;

export const deliveryMapSchema = z.object({
  shopPin: coordinatesSchema.nullable(),
  jobs: z.array(deliveryMapJobSchema),
});
export type DeliveryMap = z.infer<typeof deliveryMapSchema>;
