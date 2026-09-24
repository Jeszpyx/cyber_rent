interface BottomButton {
  onClick(callback: () => void): BottomButton;
  offClick(callback: () => void): BottomButton;
  hide(): BottomButton;
  setParams(params: { text?: string; color?: string; text_color?: string; is_active?: boolean; is_visible?: boolean }): BottomButton;
}

interface BackButton {
  onClick(callback: () => void): BackButton;
  offClick(callback: () => void): BackButton;
  show(): BackButton;
  hide(): BackButton;
}

export type HapticKind =
  | { type: 'impact'; style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft' }
  | { type: 'notification'; style: 'error' | 'success' | 'warning' }
  | { type: 'selection' };

interface HapticFeedback {
  impactOccurred(style: string): void;
  notificationOccurred(type: string): void;
  selectionChanged(): void;
}

interface TelegramWebApp {
  initData: string;
  version: string;
  platform: string;
  initDataUnsafe: { user?: { first_name?: string; username?: string }; start_param?: string };
  MainButton: BottomButton;
  BackButton?: BackButton;
  HapticFeedback?: HapticFeedback;
  ready(): void;
  expand(): void;
  isVersionAtLeast(version: string): boolean;
  disableVerticalSwipes?(): void;
  openTelegramLink(url: string): void;
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

/** Подписанная строка initData: сервер проверяет её HMAC с токеном бота (G4). */
export function telegramInitData(): string | null {
  return getWebApp()?.initData ?? null;
}

/** Параметр startapp из ссылки t.me/<bot>/<app>?startapp=<код> — код комнаты из приглашения (G5). */
export function telegramStartParam(): string | null {
  return getWebApp()?.initDataUnsafe.start_param ?? null;
}

/** Открывает ссылку t.me внутри Telegram, не закрывая Mini App; вне Telegram — false. */
export function openTelegramLink(url: string): boolean {
  const webApp = getWebApp();
  if (!webApp) return false;
  webApp.openTelegramLink(url);
  return true;
}

/** Нижняя главная кнопка Telegram; вне Telegram — null. */
export function telegramMainButton(): BottomButton | null {
  return getWebApp()?.MainButton ?? null;
}

/** Кнопка «назад» в шапке Mini App (Bot API 6.1+); вне Telegram — null. */
export function telegramBackButton(): BackButton | null {
  const webApp = getWebApp();
  return webApp?.isVersionAtLeast('6.1') ? (webApp.BackButton ?? null) : null;
}

/** Вибрация через Telegram (Bot API 6.1+); вне Telegram ничего не делает. */
export function haptic(kind: HapticKind): void {
  const webApp = getWebApp();
  const feedback = webApp?.isVersionAtLeast('6.1') ? webApp.HapticFeedback : undefined;
  if (!feedback) return;
  if (kind.type === 'impact') feedback.impactOccurred(kind.style);
  else if (kind.type === 'notification') feedback.notificationOccurred(kind.style);
  else feedback.selectionChanged();
}
