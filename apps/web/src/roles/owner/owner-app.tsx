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
            <Route path="drivers" element={<DriversScreen />} />
            <Route path="settings" element={<SettingsScreen />} />
          </Route>
        </Routes>
      </Suspense>
    </SignInGate>
  );
}
