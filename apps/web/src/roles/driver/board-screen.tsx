import { formatBirr, type DriverBoard } from '@buchi/shared';
import { QueryView } from '../../components/query-view';
import { TruckIcon } from '../../components/icons';
import { EmptyState } from '../../components/screen-state';
import { LanguageButton } from '../../components/language-button';
import { Card, CardTitle } from '../../components/ui/card';
import { useT } from '../../lib/i18n';
import { useBoard } from './driver-api';
import { HeldOfferCard, OfferCard } from './offer-card';
import { TripCard } from './trip-card';

export function BoardScreen() {
  const board = useBoard();
  const { t } = useT();
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 p-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{t('driver.jobs')}</h1>
        <LanguageButton />
      </div>
      <QueryView query={board}>{(data) => <Board board={data} />}</QueryView>
    </main>
  );
}

function Board({ board }: { board: DriverBoard }) {
  const special = board.offers.filter((offer) => offer.far);
  const open = board.offers.filter((offer) => !offer.far);
  const nothing = board.offers.length === 0 && board.held.length === 0 && board.trips.length === 0;
  const { t } = useT();
  return (
    <>
      {board.trips.length > 0 && (
        <section aria-label={t('driver.trips')} className="flex flex-col gap-2">
          <h2 className="font-semibold">{t('driver.trips')}</h2>
          {board.trips.map((trip) => (
            <TripCard key={trip.jobId} trip={trip} />
          ))}
        </section>
      )}
      {board.held.length > 0 && (
        <section aria-label={t('driver.held')} className="flex flex-col gap-2">
          <h2 className="font-semibold">{t('driver.held')}</h2>
          {board.held.map((offer) => (
            <HeldOfferCard key={offer.offerId} offer={offer} />
          ))}
        </section>
      )}
      {special.length > 0 && (
        <section aria-label={t('driver.special')} className="flex flex-col gap-2">
          <h2 className="font-semibold">{t('driver.special')}</h2>
          {special.map((offer) => (
            <OfferCard key={offer.offerId} offer={offer} />
          ))}
        </section>
      )}
      {open.length > 0 && (
        <section aria-label={t('driver.open')} className="flex flex-col gap-2">
          <h2 className="font-semibold">{t('driver.open')}</h2>
          {open.map((offer) => (
            <OfferCard key={offer.offerId} offer={offer} />
          ))}
        </section>
      )}
      {nothing && (
        <EmptyState title={t('driver.empty')} icon={<TruckIcon />}>
          {t('driver.emptyHint')}
        </EmptyState>
      )}
      <Card>
        <CardTitle>{t('driver.payouts')}</CardTitle>
        {board.earnings.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">{t('driver.noTrips')}</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {board.earnings.map((earning) => (
              <li key={earning.shopName} className="flex justify-between gap-2">
                <span>
                  {earning.shopName} · {t('zones.tripCount', { count: earning.deliveredTrips })}
                </span>
                <span className="font-semibold">{formatBirr(earning.payout)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
