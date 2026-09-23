interface TelegramWebApp {
  initData: string;
  version: string;
  platform: string;
  initDataUnsafe: { user?: { first_name?: string; username?: string } };
  ready(): void;
  expand(): void;
  isVersionAtLeast(version: string): boolean;
  disableVerticalSwipes?(): void;
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

const APP_BG = '#0b0716';

/** The script is loaded on regular websites too; initData is only non-empty inside Telegram. */
function getWebApp(): TelegramWebApp | null {
  const webApp = window.Telegram?.WebApp;
  return webApp && webApp.initData ? webApp : null;
}

export function initTelegram(): void {
  const webApp = getWebApp();
  if (!webApp) return;
  webApp.ready();
  webApp.expand();
  if (webApp.isVersionAtLeast('7.7')) webApp.disableVerticalSwipes?.();
  if (webApp.isVersionAtLeast('6.1')) {
    webApp.setHeaderColor?.(APP_BG);
    webApp.setBackgroundColor?.(APP_BG);
  }
  document.documentElement.classList.add('in-telegram');
}

export function isInTelegram(): boolean {
  return getWebApp() !== null;
}

export function telegramUserName(): string | null {
  return getWebApp()?.initDataUnsafe.user?.first_name ?? null;
}
