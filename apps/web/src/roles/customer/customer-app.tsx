import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router';
import { EmptyState, Loading } from '../../components/screen-state';
import { LanguageButton } from '../../components/language-button';
import { SignInGate } from '../../components/sign-in-gate';
import { useT } from '../../lib/i18n';

const PinPickerScreen = lazy(() => import('./pin-picker-screen'));
const OrderTrackingScreen = lazy(() => import('./order-tracking-screen'));

export function CustomerApp() {
  const { t } = useT();
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold text-muted-foreground">{t('common.brand')}</span>
        <LanguageButton />
      </div>
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
          <Route path="*" element={<EmptyState title={t('customer.openFromChannel')} />} />
        </Routes>
      </Suspense>
    </main>
  );
}
