import { formatBirr, type DriverBoard } from '@buchi/shared';
import { QueryView } from '../../components/query-view';
import { EmptyState } from '../../components/screen-state';
import { Card, CardTitle } from '../../components/ui/card';
import { useBoard } from './driver-api';
import { OfferCard } from './offer-card';
import { TripCard } from './trip-card';

export function BoardScreen() {
  const board = useBoard();
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 p-4">
      <h1 className="text-xl font-semibold">Jobs · ስራዎች</h1>
      <QueryView query={board}>{(data) => <Board board={data} />}</QueryView>
    </main>
  );
}

function Board({ board }: { board: DriverBoard }) {
  const special = board.offers.filter((offer) => offer.special);
  const open = board.offers.filter((offer) => !offer.special);
  const nothing = board.offers.length === 0 && board.trips.length === 0;
  return (
    <>
      {board.trips.length > 0 && (
        <section aria-label="My trips" className="flex flex-col gap-2">
          <h2 className="font-semibold">My trips · ጉዞዎቼ</h2>
          {board.trips.map((trip) => (
            <TripCard key={trip.jobId} trip={trip} />
          ))}
        </section>
      )}
      {special.length > 0 && (
        <section aria-label="Special offers" className="flex flex-col gap-2">
          <h2 className="font-semibold">Special offers · ልዩ ቅናሾች</h2>
          {special.map((offer) => (
            <OfferCard key={offer.offerId} offer={offer} />
          ))}
        </section>
      )}
      {open.length > 0 && (
        <section aria-label="Open jobs" className="flex flex-col gap-2">
          <h2 className="font-semibold">Open jobs · ክፍት ስራዎች</h2>
          {open.map((offer) => (
            <OfferCard key={offer.offerId} offer={offer} />
          ))}
        </section>
      )}
      {nothing && (
        <EmptyState title="No jobs right now · አሁን ስራ የለም">
          New jobs also arrive in your Telegram chat. To drive for a shop, open the invite link the
          owner sent you.
        </EmptyState>
      )}
      <Card>
        <CardTitle>Payouts owed · የሚከፈልዎ</CardTitle>
        {board.earnings.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">No delivered trips yet.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {board.earnings.map((earning) => (
              <li key={earning.shopName} className="flex justify-between gap-2">
                <span>
                  {earning.shopName} · {earning.deliveredTrips} trips
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
