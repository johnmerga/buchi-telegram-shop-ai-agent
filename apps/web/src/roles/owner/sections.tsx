import type { ReactNode } from 'react';
import {
  ChatIcon,
  DriverIcon,
  InsightsIcon,
  InventoryIcon,
  OrdersIcon,
  PaymentsIcon,
  SettingsIcon,
  SetupIcon,
  SparkIcon,
  TruckIcon,
  ZonesIcon,
} from '../../components/icons';
import type { MessageKey } from '../../lib/i18n';

export interface Section {
  /** The path under the shop, '' for its first screen. */
  to: string;
  label: MessageKey;
  description: MessageKey;
  icon: ReactNode;
}

const icon = 'size-6';

/** The sections in the bottom bar, most used first. */
export const tabSections: Section[] = [
  {
    to: '',
    label: 'nav.orders',
    description: 'nav.orders.about',
    icon: <OrdersIcon className={icon} />,
  },
  {
    to: 'payments',
    label: 'nav.payments',
    description: 'nav.payments.about',
    icon: <PaymentsIcon className={icon} />,
  },
  {
    to: 'inventory',
    label: 'nav.inventory',
    description: 'nav.inventory.about',
    icon: <InventoryIcon className={icon} />,
  },
  {
    to: 'insights',
    label: 'nav.insights',
    description: 'nav.insights.about',
    icon: <InsightsIcon className={icon} />,
  },
];

/** The sections behind **More**, the AI's own record first. */
export const moreSections: Section[] = [
  {
    to: 'ai-decisions',
    label: 'nav.aiDecisions',
    description: 'nav.aiDecisions.about',
    icon: <SparkIcon className={icon} />,
  },
  {
    to: 'deliveries',
    label: 'nav.deliveries',
    description: 'nav.deliveries.about',
    icon: <TruckIcon className={icon} />,
  },
  {
    to: 'drivers',
    label: 'nav.drivers',
    description: 'nav.drivers.about',
    icon: <DriverIcon className={icon} />,
  },
  {
    to: 'conversations',
    label: 'nav.chats',
    description: 'nav.chats.about',
    icon: <ChatIcon className={icon} />,
  },
  {
    to: 'zones',
    label: 'nav.zones',
    description: 'nav.zones.about',
    icon: <ZonesIcon className={icon} />,
  },
  {
    to: 'settings',
    label: 'nav.settings',
    description: 'nav.settings.about',
    icon: <SettingsIcon className={icon} />,
  },
  {
    to: 'setup',
    label: 'nav.setup',
    description: 'nav.setup.about',
    icon: <SetupIcon className={icon} />,
  },
];
