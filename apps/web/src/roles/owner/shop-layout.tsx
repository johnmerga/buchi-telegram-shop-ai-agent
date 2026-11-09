import { Suspense } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { MoreIcon } from '../../components/icons';
import { LanguageButton } from '../../components/language-button';
import { QueryView } from '../../components/query-view';
import { Loading } from '../../components/screen-state';
import { cn } from '../../lib/cn';
import { useT } from '../../lib/i18n';
import { useShop } from './owner-api';
import { moreSections, tabSections, type Section } from './sections';
import { useShopId } from './use-shop-id';

/** The first part of the path under the shop, such as 'inventory' for 'inventory/new'. */
function useSectionPath(shopId: string): string {
  const { pathname } = useLocation();
  const marker = `/shops/${shopId}`;
  const rest = pathname.slice(pathname.indexOf(marker) + marker.length).replace(/^\//, '');
  return rest.split('/')[0] ?? '';
}

/**
 * Loads the shop before any screen, so a user who does not own it sees "Not allowed" and nothing
 * else: no navigation and no shop data.
 */
export function ShopLayout() {
  const shopId = useShopId();
  const shop = useShop(shopId);
  const { t } = useT();
  const section = useSectionPath(shopId);
  const inMore = section === 'more' || moreSections.some((item) => item.to === section);
  return (
    <QueryView query={shop}>
      {(details) => (
        <div className="mx-auto flex min-h-dvh max-w-3xl flex-col">
          <header className="sticky top-0 z-[1000] border-b border-border bg-background/95 backdrop-blur">
            <div className="flex items-center gap-3 px-4 py-2.5">
              <span
                aria-hidden="true"
                className="grid size-10 shrink-0 place-items-center rounded-full bg-primary text-base font-semibold text-primary-foreground"
              >
                {details.name.trim().charAt(0).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <h1 className="truncate text-base leading-tight font-semibold">{details.name}</h1>
                <p className="text-xs text-muted-foreground">{t('nav.subtitle')}</p>
              </div>
              <LanguageButton />
            </div>
          </header>
          <main className="flex flex-1 flex-col gap-4 p-4 pb-[calc(6rem+env(safe-area-inset-bottom))]">
            <Suspense fallback={<Loading />}>
              <Outlet />
            </Suspense>
          </main>
          <nav
            aria-label={t('nav.label')}
            className="fixed inset-x-0 bottom-0 z-[1000] border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
          >
            <div className="mx-auto grid max-w-3xl grid-cols-5">
              {tabSections.map((item) => (
                <TabLink key={item.to} item={item} />
              ))}
              <TabLink
                item={{
                  to: 'more',
                  label: 'nav.more',
                  description: 'nav.more',
                  icon: <MoreIcon className="size-6" />,
                }}
                active={inMore}
              />
            </div>
          </nav>
        </div>
      )}
    </QueryView>
  );
}

function TabLink({ item, active }: { item: Section; active?: boolean }) {
  const { t } = useT();
  return (
    <NavLink
      to={item.to}
      end={item.to === ''}
      className={({ isActive }) => {
        const on = active ?? isActive;
        return cn(
          'group flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-[11px] font-medium transition-colors',
          on ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
        );
      }}
    >
      {({ isActive }) => {
        const on = active ?? isActive;
        return (
          <>
            <span
              className={cn(
                'grid h-7 w-12 place-items-center rounded-full transition-colors',
                on && 'bg-primary/15',
              )}
            >
              {item.icon}
            </span>
            <span className="max-w-full truncate">{t(item.label)}</span>
          </>
        );
      }}
    </NavLink>
  );
}
