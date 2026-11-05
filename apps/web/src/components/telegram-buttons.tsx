import { useEffect } from 'react';
import { telegramWebApp } from '../lib/telegram';
import { Button } from './ui/button';

/** Shows Telegram's own back button while the screen is open. Browsers use their own. */
export function useBackButton(onBack: () => void): void {
  useEffect(() => {
    const back = telegramWebApp()?.BackButton;
    if (!back) return;
    back.show();
    back.onClick(onBack);
    return () => {
      back.offClick(onBack);
      back.hide();
    };
  }, [onBack]);
}

/**
 * The screen's main action. Inside Telegram it is Telegram's bottom button, which stays reachable
 * above the keyboard; in a browser it is a full-width button.
 */
export function MainAction({
  text,
  onClick,
  disabled = false,
  busy = false,
}: {
  text: string;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
}) {
  const main = telegramWebApp()?.MainButton;

  useEffect(() => {
    if (!main) return;
    main.setParams({ text, is_visible: true, is_active: !disabled && !busy });
    if (busy) main.showProgress();
    else main.hideProgress();
    main.onClick(onClick);
    return () => {
      main.offClick(onClick);
      main.setParams({ is_visible: false });
    };
  }, [main, text, onClick, disabled, busy]);

  if (main) return null;
  return (
    <Button className="w-full" onClick={onClick} disabled={disabled || busy}>
      {busy ? 'Please wait…' : text}
    </Button>
  );
}
