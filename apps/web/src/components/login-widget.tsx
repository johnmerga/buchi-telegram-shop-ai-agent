import { loginWidgetConfigSchema } from '@buchi/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { readError } from '../lib/api-error';
import { QueryView } from './query-view';

/** What the widget passes to its callback: every field Telegram signed. */
export type TelegramLoginData = Record<string, string | number>;

declare global {
  interface Window {
    onBuchiTelegramAuth?: (user: TelegramLoginData) => void;
  }
}

async function loadConfig() {
  const res = await fetch('/auth/login-widget');
  if (!res.ok) throw await readError(res);
  return loginWidgetConfigSchema.parse(await res.json());
}

/**
 * The Telegram Login Widget (https://core.telegram.org/widgets/login). It only works on the domain
 * set for the bot with BotFather's /setdomain.
 */
export function LoginWidget({ onAuth }: { onAuth: (data: TelegramLoginData) => void }) {
  const config = useQuery({ queryKey: ['login-widget'], queryFn: loadConfig });
  return (
    <QueryView query={config}>
      {({ botUsername }) => <WidgetScript botUsername={botUsername} onAuth={onAuth} />}
    </QueryView>
  );
}

function WidgetScript({
  botUsername,
  onAuth,
}: {
  botUsername: string;
  onAuth: (data: TelegramLoginData) => void;
}) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = container.current;
    if (!host) return;
    window.onBuchiTelegramAuth = onAuth;
    const script = document.createElement('script');
    script.async = true;
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.dataset.telegramLogin = botUsername;
    script.dataset.size = 'large';
    script.dataset.onauth = 'onBuchiTelegramAuth(user)';
    host.append(script);
    return () => {
      host.replaceChildren();
      delete window.onBuchiTelegramAuth;
    };
  }, [botUsername, onAuth]);

  return <div ref={container} className="flex justify-center" />;
}
