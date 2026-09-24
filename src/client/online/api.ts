import type { GameModeId } from '../../shared/game/modes';
import type { RoomView, ServerConfig } from '../../shared/game/room';
import type { Action } from '../../shared/game/types';
import { openTelegramLink, telegramInitData } from '../telegram';
import { guestToken } from './onlineStorage';

/** Ошибка сервера с текстом для игрока; status 0 — нет связи. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** В Telegram — подписанная initData, на сайте — гостевой токен. */
function authorization(): string {
  const initData = telegramInitData();
  return initData ? `tma ${initData}` : `guest ${guestToken()}`;
}

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown, signal?: AbortSignal): Promise<T | null> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers: { Authorization: authorization(), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiError(0, 'Нет связи с сервером.');
  }
  if (response.status === 204) return null;
  const data = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok) throw new ApiError(response.status, data?.error ?? `Ошибка сервера (${response.status}).`);
  return data;
}

const room = (code: string, path = '') => `/rooms/${encodeURIComponent(code)}${path}`;

export const onlineApi = {
  config: () => request<ServerConfig>('GET', '/config'),
  create: (name: string, mode: GameModeId, bots: number) => request<RoomView>('POST', '/rooms', { name, mode, bots }),
  join: (code: string, name: string, signal?: AbortSignal) => request<RoomView>('POST', room(code, '/join'), { name }, signal),
  leave: (code: string) => request<{ room: RoomView | null }>('POST', room(code, '/leave'), {}),
  configure: (code: string, changes: { mode?: GameModeId; bots?: number }) => request<RoomView>('POST', room(code, '/config'), changes),
  start: (code: string) => request<RoomView>('POST', room(code, '/start'), {}),
  act: (code: string, action: Action) => request<RoomView>('POST', room(code, '/action'), { action }),
  /** long-polling: ответ приходит, когда версия комнаты станет больше since; null — изменений не было */
  poll: (code: string, since: number, signal: AbortSignal) => request<RoomView>('GET', room(code, `?since=${since}`), undefined, signal),
};

let configRequest: Promise<ServerConfig | null> | null = null;

export function serverConfig(): Promise<ServerConfig | null> {
  configRequest ??= onlineApi.config().catch(() => {
    configRequest = null;
    return null;
  });
  return configRequest;
}

/** Ссылка-приглашение: прямо в Mini App, через бота (/start <код>) или на сайт с ?room=. */
export function inviteLink(config: ServerConfig | null, code: string): string {
  const tg = config?.telegramApp;
  if (tg?.app) return `https://t.me/${tg.bot}/${tg.app}?startapp=${code}`;
  if (tg) return `https://t.me/${tg.bot}?start=${code}`;
  return `${location.origin}/?room=${code}`;
}

/**
 * Поделиться приглашением: в Telegram — окно выбора чата, на телефоне — системное меню,
 * иначе ссылка копируется. Возвращает, что показать игроку, или null.
 */
export async function shareInvite(link: string, code: string): Promise<string | null> {
  const text = `Го в Cyber Rent! Комната ${code}`;
  if (openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`)) return null;
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: 'Cyber Rent', text, url: link });
      return null;
    } catch {
      // отменили или не поддерживается — скопируем
    }
  }
  try {
    await navigator.clipboard.writeText(link);
    return 'Ссылка скопирована';
  } catch {
    return `Ссылка: ${link}`;
  }
}
