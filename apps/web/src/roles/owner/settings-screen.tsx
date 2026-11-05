import { QueryView } from '../../components/query-view';
import { DeliverySettingsForm } from './delivery-settings-form';
import { useDeliverySettings } from './owner-api';
import { SaverRunTimesForm } from './saver-run-times-form';
import { useShopId } from './use-shop-id';

export default function SettingsScreen() {
  const shopId = useShopId();
  const delivery = useDeliverySettings(shopId);
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
    </div>
  );
}
