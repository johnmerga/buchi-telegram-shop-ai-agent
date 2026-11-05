import { Suspense } from 'react';
import { NavLink, Outlet } from 'react-router';
import { QueryView } from '../../components/query-view';
import { Loading } from '../../components/screen-state';
import { cn } from '../../lib/cn';
import { useShop } from './owner-api';
import { useShopId } from './use-shop-id';

const tabs = [
  { to: '', label: 'Orders', amharic: 'ትዕዛዞች' },
  { to: 'payments', label: 'Payments', amharic: 'ክፍያዎች' },
  { to: 'inventory', label: 'Inventory', amharic: 'ዕቃዎች' },
  { to: 'deliveries', label: 'Deliveries', amharic: 'ማድረሻዎች' },
  { to: 'drivers', label: 'Drivers', amharic: 'ሹፌሮች' },
  { to: 'conversations', label: 'Chats', amharic: 'ውይይቶች' },
  { to: 'ai-decisions', label: 'AI decisions', amharic: 'ውሳኔዎች' },
  { to: 'zones', label: 'Zones', amharic: 'ዞኖች' },
  { to: 'insights', label: 'Insights', amharic: 'ግንዛቤዎች' },
  { to: 'settings', label: 'Settings', amharic: 'ማስተካከያ' },
  { to: 'setup', label: 'Setup', amharic: 'ማዋቀር' },
];

/**
 * Loads the shop before any screen, so a user who does not own it sees "Not allowed" and nothing
 * else: no navigation and no shop data.
 */
export function ShopLayout() {
  const shopId = useShopId();
  const shop = useShop(shopId);
  return (
    <QueryView query={shop}>
      {(details) => (
        <div className="mx-auto flex min-h-dvh max-w-3xl flex-col">
          <header className="sticky top-0 z-[1000] border-b border-border bg-background">
            <h1 className="truncate px-4 pt-3 text-lg font-semibold">{details.name}</h1>
            <nav aria-label="Shop sections" className="flex gap-1 overflow-x-auto px-2 pb-2">
              {tabs.map((tab) => (
                <NavLink
                  key={tab.to}
                  to={tab.to}
                  end
                  className={({ isActive }) =>
                    cn(
                      'flex min-h-11 shrink-0 flex-col items-center justify-center rounded-lg px-3 text-xs',
                      isActive ? 'bg-primary text-primary-foreground' : 'text-foreground',
                    )
                  }
                >
                  <span className="font-medium">{tab.label}</span>
                  <span lang="am">{tab.amharic}</span>
                </NavLink>
              ))}
            </nav>
          </header>
          <main className="flex flex-1 flex-col gap-4 p-4">
            <Suspense fallback={<Loading />}>
              <Outlet />
            </Suspense>
          </main>
        </div>
      )}
    </QueryView>
  );
}
