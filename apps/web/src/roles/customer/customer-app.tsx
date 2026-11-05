import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router';
import { EmptyState, Loading } from '../../components/screen-state';
import { SignInGate } from '../../components/sign-in-gate';

const PinPickerScreen = lazy(() => import('./pin-picker-screen'));
const OrderTrackingScreen = lazy(() => import('./order-tracking-screen'));

export function CustomerApp() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 p-4">
      <Suspense fallback={<Loading />}>
        <Routes>
          {/* The pin goes back through the chat, so the picker needs no sign-in. */}
          <Route path="pin" element={<PinPickerScreen />} />
          <Route
            path="orders/:orderId"
            element={
              <SignInGate browserSignIn={false}>
                <OrderTrackingScreen />
              </SignInGate>
            }
          />
          <Route
            path="*"
            element={<EmptyState title="Open Buchi from a shop’s channel post in Telegram." />}
          />
        </Routes>
      </Suspense>
    </main>
  );
}
