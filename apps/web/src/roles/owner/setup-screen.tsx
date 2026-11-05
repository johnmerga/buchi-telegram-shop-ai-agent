import { Link } from 'react-router';
import { QueryView } from '../../components/query-view';
import { Card } from '../../components/ui/card';
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

  return (
    <QueryView query={shop}>
      {(details) => (
        <div className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold">Set up your shop · ሱቅዎን ያዋቅሩ</h2>
          <ChannelStep shopId={shopId} channelTitle={details.channelTitle} />
          <LocationStep shopId={shopId} shop={details} />
          <PaymentAccountsStep shopId={shopId} saved={details.paymentAccounts} />
          <LinkStep
            title="4. Delivery prices"
            done={delivery.data?.settings != null}
            to="../settings"
            action="Set delivery prices"
          >
            Without them, customers can only pick up at the shop.
          </LinkStep>
          <LinkStep
            title="5. Products"
            done={(products.data?.length ?? 0) > 0}
            to="../inventory/new"
            action="Add a product"
          >
            Add products with sizes and stock, then post them to your channel.
          </LinkStep>
          <LinkStep
            title="6. Drivers"
            done={(drivers.data?.length ?? 0) > 0}
            to="../drivers"
            action="Invite a driver"
          >
            Drivers join with a one-time link that you send them.
          </LinkStep>
        </div>
      )}
    </QueryView>
  );
}

function LinkStep(props: {
  title: string;
  done: boolean;
  to: string;
  action: string;
  children: string;
}) {
  return (
    <Card className="flex flex-col gap-2">
      <StepTitle title={props.title} done={props.done} />
      <p className="text-sm text-muted-foreground">{props.children}</p>
      <Link to={props.to} relative="path" className="text-sm font-medium text-link underline">
        {props.action}
      </Link>
    </Card>
  );
}
