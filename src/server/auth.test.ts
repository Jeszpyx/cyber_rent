import { describe, expect, it } from 'vitest';
import { guestUserId, identify, verifyInitData } from './auth';

// Пример из документации @tma.js/init-data-node: подписан этим (публичным, тестовым) токеном.
const TOKEN = '5768337691:AAH5YkoiEuPk8-FZa32hStHTqXiLPtAEhx8';
const INIT_DATA =
  'query_id=AAHdF6IQAAAAAN0XohDhrOrc' +
  '&user=%7B%22id%22%3A279058397%2C%22first_name%22%3A%22Vladislav%22%2C%22last_name%22%3A%22Kibenko%22%2C%22username%22%3A%22vdkfrost%22%2C%22language_code%22%3A%22ru%22%2C%22is_premium%22%3Atrue%7D' +
  '&auth_date=1662771648' +
  '&hash=c501b71e775f74ce10e377dea85a7ea24ecd640b223ea86dfe453e0eaed2e2b2';
const SIGNED_AT = 1662771648;

describe('проверка Telegram initData (G4)', () => {
  it('accepts data signed with the bot token', () => {
    const user = verifyInitData(INIT_DATA, TOKEN, SIGNED_AT + 60);
    expect(user).toMatchObject({ id: 279058397, first_name: 'Vladislav', username: 'vdkfrost' });
  });

  it('rejects a wrong token, changed fields and a missing hash', () => {
    expect(verifyInitData(INIT_DATA, `${TOKEN}x`, SIGNED_AT)).toBeNull();
    expect(verifyInitData(INIT_DATA.replace('279058397', '279058398'), TOKEN, SIGNED_AT)).toBeNull();
    expect(verifyInitData(INIT_DATA.replace(/&hash=.*/, ''), TOKEN, SIGNED_AT)).toBeNull();
    expect(verifyInitData(`${INIT_DATA}&extra=1`, TOKEN, SIGNED_AT)).toBeNull();
    expect(verifyInitData('', TOKEN, SIGNED_AT)).toBeNull();
  });

  it('rejects stale data', () => {
    expect(verifyInitData(INIT_DATA, TOKEN, SIGNED_AT + 24 * 60 * 60 + 1)).toBeNull();
    expect(verifyInitData(INIT_DATA, TOKEN, SIGNED_AT + 100, 60)).toBeNull();
  });

  it('identifies a Telegram user by id and name', () => {
    expect(identify(`tma ${INIT_DATA}`, TOKEN, SIGNED_AT)).toEqual({
      ok: true,
      identity: { userId: 'tg:279058397', name: 'Vladislav Kibenko' },
    });
    expect(identify(`tma ${INIT_DATA}`, undefined, SIGNED_AT)).toMatchObject({ ok: false, status: 503 });
    expect(identify(`tma ${INIT_DATA}`, 'другой:токен', SIGNED_AT)).toMatchObject({ ok: false, status: 401 });
  });

  it('identifies a guest by the hash of their token', () => {
    const token = 'guest-token-0123456789abcdef';
    const result = identify(`guest ${token}`, undefined, 0);
    expect(result).toEqual({ ok: true, identity: { userId: guestUserId(token), name: null } });
    expect(guestUserId(token)).toMatch(/^g:[0-9a-f]{32}$/);
    expect(guestUserId(token)).not.toContain(token);
    expect(identify('guest short', undefined, 0)).toMatchObject({ ok: false, status: 401 });
    expect(identify(undefined, TOKEN, 0)).toMatchObject({ ok: false, status: 401 });
    expect(identify(`Bearer ${token}`, TOKEN, 0)).toMatchObject({ ok: false, status: 401 });
  });
});
