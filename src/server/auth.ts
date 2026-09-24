import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { normalizeName } from '../shared/game/room';

/** initData старше суток не принимаем: Mini App получает свежую при каждом открытии. */
export const INIT_DATA_MAX_AGE_SEC = 24 * 60 * 60;
const GUEST_TOKEN = /^[A-Za-z0-9_-]{20,128}$/;

export interface TelegramUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
}

/** Кто делает запрос. name — из Telegram; у гостя null, имя приходит в теле запроса. */
export interface Identity {
  userId: string;
  name: string | null;
}

export type AuthResult = { ok: true; identity: Identity } | { ok: false; status: number; error: string };

/**
 * Проверка Telegram.WebApp.initData (core.telegram.org/bots/webapps, «Validating data received via the Mini App»):
 * data-check-string — все поля, кроме hash, по алфавиту ключей в виде key=value через \n;
 * secret_key = HMAC_SHA256(key: "WebAppData", data: bot_token); hash = hex(HMAC_SHA256(key: secret_key, data: data-check-string)).
 */
export function verifyInitData(initData: string, botToken: string, nowSec: number, maxAgeSec = INIT_DATA_MAX_AGE_SEC): TelegramUser | null {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) return null;
  params.delete('hash');
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = createHmac('sha256', secret).update(dataCheckString).digest();
  if (!timingSafeEqual(Buffer.from(hash, 'hex'), expected)) return null;

  const authDate = Number(params.get('auth_date'));
  if (!Number.isFinite(authDate) || nowSec - authDate > maxAgeSec) return null;
  try {
    const user: unknown = JSON.parse(params.get('user') ?? 'null');
    if (typeof user !== 'object' || user === null || typeof (user as TelegramUser).id !== 'number') return null;
    return user as TelegramUser;
  } catch {
    return null;
  }
}

/** Гость хранит случайный токен у себя; наружу (в комнату) уходит только его хэш. */
export function guestUserId(token: string): string {
  return `g:${createHash('sha256').update(token).digest('hex').slice(0, 32)}`;
}

function telegramName(user: TelegramUser): string | null {
  return normalizeName([user.first_name, user.last_name].filter(Boolean).join(' ')) ?? normalizeName(user.username);
}

/**
 * Заголовок Authorization: `tma <initData>` внутри Telegram (нужен BOT_TOKEN на сервере)
 * или `guest <token>` на обычном сайте.
 */
export function identify(header: string | undefined, botToken: string | undefined, nowSec: number): AuthResult {
  const [scheme, ...rest] = (header ?? '').split(' ');
  const credentials = rest.join(' ');
  if (scheme === 'tma') {
    if (!botToken) return { ok: false, status: 503, error: 'Вход через Telegram не настроен на сервере.' };
    const user = verifyInitData(credentials, botToken, nowSec);
    if (!user) return { ok: false, status: 401, error: 'Данные Telegram не прошли проверку. Переоткройте игру.' };
    return { ok: true, identity: { userId: `tg:${user.id}`, name: telegramName(user) } };
  }
  if (scheme === 'guest' && GUEST_TOKEN.test(credentials)) {
    return { ok: true, identity: { userId: guestUserId(credentials), name: null } };
  }
  return { ok: false, status: 401, error: 'Нужна авторизация.' };
}
