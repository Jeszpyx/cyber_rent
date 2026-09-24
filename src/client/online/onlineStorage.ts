/** Онлайн-режим на этом устройстве: гостевой токен, имя гостя и последняя комната. */
const TOKEN_KEY = 'cyber-rent:guest-token';
const NAME_KEY = 'cyber-rent:guest-name';
const ROOM_KEY = 'cyber-rent:room';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // хранилище недоступно — гость получит новый токен в следующий раз
  }
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

let sessionToken: string | null = null;

/** Случайный токен гостя: по нему (точнее, по его хэшу) сервер узнаёт игрока на сайте без Telegram. */
export function guestToken(): string {
  sessionToken ??= read(TOKEN_KEY);
  if (!sessionToken) {
    sessionToken = randomToken();
    write(TOKEN_KEY, sessionToken);
  }
  return sessionToken;
}

export function loadGuestName(): string {
  return read(NAME_KEY) ?? '';
}

export function saveGuestName(name: string): void {
  write(NAME_KEY, name.trim() || null);
}

/** Комната, в которую можно вернуться из меню; null — забыть. */
export function loadLastRoom(): string | null {
  return read(ROOM_KEY);
}

export function saveLastRoom(code: string | null): void {
  write(ROOM_KEY, code);
}
