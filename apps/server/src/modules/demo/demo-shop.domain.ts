import type { DeliverySettings } from '@buchi/shared';
import { demoTelegramId } from '../../shared/demo-ids';
import { ADDIS_AREAS } from './demo-history.domain';

/**
 * Delivery prices for the demo: a short Bole trip costs about 100 birr, and a far trip of 28 km
 * or more costs more than the cap, so its price needs the owner.
 */
export const DEMO_DELIVERY_SETTINGS: DeliverySettings = {
  baseFee: '30.00',
  ratePerKm: '12.00',
  ratePerMinute: '1.50',
  freeRadiusKm: 2,
  standardRangeKm: 8,
  farRangeKm: 35,
  farCap: '400.00',
  saverDiscountPercent: 20,
};

/** The demo's drivers. Their Telegram IDs are made up, so the bot never messages them. */
export const DEMO_DRIVERS = [
  { name: 'Abebe Moto', username: 'demo_abebe_moto' },
  { name: 'Kebede Rides', username: 'demo_kebede_rides' },
  { name: 'Tomas Delivery', username: 'demo_tomas_delivery' },
  { name: 'Yared Express', username: 'demo_yared_express' },
].map((driver, index) => ({ ...driver, telegramUserId: demoTelegramId(1000 + index) }));

const area = (name: (typeof ADDIS_AREAS)[number]['name']) => {
  const found = ADDIS_AREAS.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`No demo area ${name}`);
  return { latitude: found.latitude, longitude: found.longitude };
};

/** Drivers' reports that the operations agent and far prices read during the demo. */
export const DEMO_AREA_NOTES = [
  {
    near: area('Ayat'),
    note: 'Roadworks on the Ayat main road, expect 20 extra minutes.',
    validHours: 72,
  },
  {
    near: area('Piassa'),
    note: 'Heavy traffic around Piassa in the evening, park near the Post Office.',
    validHours: 72,
  },
];
