import { useMemo, useState, type ReactNode } from 'react';
import { Api } from '../lib/api';
import { Auth, exchange } from '../lib/auth';
import { telegramWebApp } from '../lib/telegram';
import { ApiProvider } from './api-context';
import { LoginWidget, type TelegramLoginData } from './login-widget';
import { Card } from './ui/card';

/**
 * Signs the user in before `children` render. Inside Telegram the Mini App's launch data signs in
 * silently. In a browser, `browserSignIn` shows the Login Widget; otherwise the page asks the user
 * to open it from Telegram.
 */
export function SignInGate({
  browserSignIn,
  children,
}: {
  browserSignIn: boolean;
  children: ReactNode;
}) {
  const initData = telegramWebApp()?.initData ?? '';
  const [widgetData, setWidgetData] = useState<TelegramLoginData>();

  const api = useMemo(() => {
    if (initData !== '') return new Api(new Auth(exchange('/auth/mini-app', { initData })));
    if (widgetData) return new Api(new Auth(exchange('/auth/login-widget', widgetData)));
    return undefined;
  }, [initData, widgetData]);

  if (api) return <ApiProvider api={api}>{children}</ApiProvider>;
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-4">
      <h1 className="text-center text-2xl font-semibold">ቡቺ Buchi</h1>
      <Card className="flex flex-col gap-3 text-center">
        {browserSignIn ? (
          <>
            <p className="text-sm text-muted-foreground">
              Sign in with the Telegram account that owns your shop · በቴሌግራም ይግቡ
            </p>
            <LoginWidget onAuth={setWidgetData} />
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Open this page from the Buchi bot in Telegram · ከቴሌግራም ቦቱ ይክፈቱ
          </p>
        )}
      </Card>
    </main>
  );
}
