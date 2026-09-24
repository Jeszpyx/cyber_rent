import { useEffect, useEffectEvent } from 'react';
import { telegramBackButton, telegramMainButton } from '../telegram';

const BUTTON_COLOR = '#ff2e9a';
const BUTTON_TEXT_COLOR = '#ffffff';

export interface MainButtonConfig {
  text: string;
  onClick: () => void;
  disabled?: boolean;
}

/**
 * Дублирует главное действие экрана в нижнюю кнопку Telegram. null — кнопка скрыта.
 * Вне Telegram ничего не делает: на сайте те же действия доступны кнопками на странице.
 */
export function useMainButton(config: MainButtonConfig | null): void {
  const handleClick = useEffectEvent(() => {
    if (config && !config.disabled) config.onClick();
  });
  const text = config?.text ?? null;
  const active = !config?.disabled;

  useEffect(() => {
    const button = telegramMainButton();
    if (!button) return;
    const listener = () => handleClick();
    button.onClick(listener);
    return () => {
      button.offClick(listener);
      button.hide();
    };
  }, []);

  useEffect(() => {
    const button = telegramMainButton();
    if (!button) return;
    if (text === null) {
      button.hide();
      return;
    }
    button.setParams({ text, color: BUTTON_COLOR, text_color: BUTTON_TEXT_COLOR, is_active: active, is_visible: true });
  }, [text, active]);
}

/** Показывает кнопку «назад» в шапке Telegram, пока onBack не null (закрытие модалок). */
export function useBackButton(onBack: (() => void) | null): void {
  const handleBack = useEffectEvent(() => onBack?.());
  const visible = onBack !== null;

  useEffect(() => {
    const button = telegramBackButton();
    if (!button || !visible) return;
    const listener = () => handleBack();
    button.onClick(listener).show();
    return () => {
      button.offClick(listener).hide();
    };
  }, [visible]);
}
