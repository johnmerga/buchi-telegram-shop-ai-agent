import { Link } from 'react-router';
import { QueryView } from '../../components/query-view';
import { Card } from '../../components/ui/card';
import { useT, type MessageKey } from '../../lib/i18n';
import { ChannelStep } from './channel-step';
import { LocationStep } from './location-step';
import { useDeliverySettings, useDrivers, useProducts, useShop } from './owner-api';
import { PaymentAccountsStep } from './payment-accounts-step';
import { StepTitle } from './step-title';
import { useShopId } from './use-shop-id';

/** Onboarding as a checklist: each step shows whether it is done and can be redone any time. */
export default function SetupScreen() {
  const shopId = useShopId();
  const shop = useShop(shopId);
  const delivery = useDeliverySettings(shopId);
  const products = useProducts(shopId);
  const drivers = useDrivers(shopId);
  const { t } = useT();

  return (
    <QueryView query={shop}>
      {(details) => (
        <div className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold">{t('setup.title')}</h2>
          <ChannelStep shopId={shopId} channelTitle={details.channelTitle} />
          <LocationStep shopId={shopId} shop={details} />
          <PaymentAccountsStep shopId={shopId} saved={details.paymentAccounts} />
          <LinkStep
            title="setup.delivery"
            done={delivery.data?.settings != null}
            to="../settings"
            action="setup.deliveryAction"
            body="setup.deliveryHint"
          />
          <LinkStep
            title="setup.products"
            done={(products.data?.length ?? 0) > 0}
            to="../inventory/new"
            action="setup.productsAction"
            body="setup.productsHint"
          />
          <LinkStep
            title="setup.drivers"
            done={(drivers.data?.length ?? 0) > 0}
            to="../drivers"
            action="drivers.invite"
            body="setup.driversHint"
          />
        </div>
      )}
    </QueryView>
  );
}

function LinkStep(props: {
  title: MessageKey;
  done: boolean;
  to: string;
  action: MessageKey;
  body: MessageKey;
}) {
  const { t } = useT();
  return (
    <Card className="flex flex-col gap-2">
      <StepTitle title={t(props.title)} done={props.done} />
      <p className="text-sm text-muted-foreground">{t(props.body)}</p>
      <Link to={props.to} relative="path" className="text-sm font-medium text-link underline">
        {t(props.action)}
      </Link>
    </Card>
  );
}
