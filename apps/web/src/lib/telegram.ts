/**
 * The parts of Telegram's Mini App API (https://core.telegram.org/bots/webapps) that Buchi uses.
 * The official script defines `window.Telegram.WebApp`; this file only types and wraps it.
 */
interface BottomButton {
  setParams(params: { text?: string; is_active?: boolean; is_visible?: boolean }): void;
  showProgress(leaveActive?: boolean): void;
  hideProgress(): void;
  onClick(callback: () => void): void;
  offClick(callback: () => void): void;
}

interface BackButton {
  show(): void;
  hide(): void;
  onClick(callback: () => void): void;
  offClick(callback: () => void): void;
}

/** Bot API 8.0. A missing location is `null`, for example when the user declines access. */
interface LocationManager {
  isInited: boolean;
  isLocationAvailable: boolean;
  init(callback?: () => void): void;
  getLocation(callback: (location: { latitude: number; longitude: number } | null) => void): void;
}

export interface WebApp {
  initData: string;
  /** "unknown" when the page is open in a plain browser. */
  platform: string;
  ready(): void;
  expand(): void;
  close(): void;
  /** Only for a Mini App opened from a reply keyboard button. It closes the Mini App. */
  sendData(data: string): void;
  openTelegramLink(url: string): void;
  BackButton: BackButton;
  MainButton: BottomButton;
  LocationManager?: LocationManager;
}

declare global {
  interface Window {
    Telegram?: { WebApp: WebApp };
  }
}

/** The Mini App API when the page runs inside Telegram, or `undefined` in a plain browser. */
export function telegramWebApp(): WebApp | undefined {
  const webApp = window.Telegram?.WebApp;
  return webApp && webApp.platform !== 'unknown' ? webApp : undefined;
}

/** Tells Telegram the page is ready, so it hides its loader, and opens the Mini App full height. */
export function startMiniApp(): void {
  const webApp = telegramWebApp();
  webApp?.ready();
  webApp?.expand();
}
