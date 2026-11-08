import { QueryView } from '../../components/query-view';
import { useLedger } from './dashboard-api';
import { DeleteShopCard } from './delete-shop-card';
import { DeliverySettingsForm } from './delivery-settings-form';
import { LedgerForm } from './ledger-form';
import { useDeliverySettings, useShop } from './owner-api';
import { RunNowCard } from './run-now-card';
import { SaverRunTimesForm } from './saver-run-times-form';
import { useShopId } from './use-shop-id';

export default function SettingsScreen() {
  const shopId = useShopId();
  const delivery = useDeliverySettings(shopId);
  const ledger = useLedger(shopId);
  const shop = useShop(shopId);
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Settings · ማስተካከያ</h2>
      <QueryView query={delivery}>
        {(view) => (
          <>
            <DeliverySettingsForm shopId={shopId} saved={view.settings} />
            <SaverRunTimesForm
              shopId={shopId}
              saved={view.saverRunTimes}
              enabled={view.settings !== null}
            />
          </>
        )}
      </QueryView>
      <QueryView query={ledger}>
        {(saved) => <LedgerForm shopId={shopId} saved={saved} />}
      </QueryView>
      <RunNowCard shopId={shopId} />
      <QueryView query={shop}>
        {(details) => <DeleteShopCard shopId={shopId} name={details.name} />}
      </QueryView>
    </div>
  );
}
