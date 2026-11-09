import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router';
import { Loading } from '../../components/screen-state';
import { SignInGate } from '../../components/sign-in-gate';
import { ShopLayout } from './shop-layout';
import { ShopsHome } from './shops-home';

// Each screen is its own chunk, so opening the board does not load the product editor or the map.
const OrdersScreen = lazy(() => import('./orders-screen'));
const SetupScreen = lazy(() => import('./setup-screen'));
const InventoryScreen = lazy(() => import('./inventory-screen'));
const ProductEditor = lazy(() => import('./product-editor'));
const DriversScreen = lazy(() => import('./drivers-screen'));
const SettingsScreen = lazy(() => import('./settings-screen'));
const PaymentReviewScreen = lazy(() => import('./payment-review-screen'));
const DeliveriesScreen = lazy(() => import('./deliveries-screen'));
const ConversationsScreen = lazy(() => import('./conversations-screen'));
const AiDecisionsScreen = lazy(() => import('./ai-decisions-screen'));
const ZonesScreen = lazy(() => import('./zones-screen'));
const InsightsScreen = lazy(() => import('./insights-screen'));
const MoreScreen = lazy(() => import('./more-screen'));

/** The owner Mini App, which is also the browser dashboard with the Login Widget. */
export function OwnerApp() {
  return (
    <SignInGate browserSignIn>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route index element={<ShopsHome />} />
          <Route path="shops/:shopId" element={<ShopLayout />}>
            <Route index element={<OrdersScreen />} />
            <Route path="setup" element={<SetupScreen />} />
            <Route path="inventory" element={<InventoryScreen />} />
            <Route path="inventory/new" element={<ProductEditor />} />
            <Route path="inventory/:productId" element={<ProductEditor />} />
            <Route path="payments" element={<PaymentReviewScreen />} />
            <Route path="deliveries" element={<DeliveriesScreen />} />
            <Route path="drivers" element={<DriversScreen />} />
            <Route path="conversations" element={<ConversationsScreen />} />
            <Route path="ai-decisions" element={<AiDecisionsScreen />} />
            <Route path="zones" element={<ZonesScreen />} />
            <Route path="insights" element={<InsightsScreen />} />
            <Route path="settings" element={<SettingsScreen />} />
            <Route path="more" element={<MoreScreen />} />
          </Route>
        </Routes>
      </Suspense>
    </SignInGate>
  );
}
