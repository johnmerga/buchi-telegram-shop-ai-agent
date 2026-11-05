import type { EventBus } from '../../src/shared/events';

/** For tests that do not follow domain events: publishing does nothing. */
export const noEvents: Pick<EventBus, 'publish'> = { publish: () => Promise.resolve() };
