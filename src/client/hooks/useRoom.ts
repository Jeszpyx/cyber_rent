import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameModeId } from '../../shared/game/modes';
import type { RoomView } from '../../shared/game/room';
import type { Action } from '../../shared/game/types';
import { ApiError, onlineApi } from '../online/api';
import { saveLastRoom } from '../online/onlineStorage';

/** Пауза перед повторным запросом, если связь пропала. */
const RETRY_MS = 2500;
/** Столько держится подсказка об отклонённом действии. */
const NOTICE_MS = 3500;

export interface RoomConnection {
  view: RoomView | null;
  /** когда у живого игрока выйдет время (ms, часы этого устройства); null — таймер не идёт */
  deadline: number | null;
  /** комнаты нет или в неё нельзя войти — дальше делать нечего */
  fatal: string | null;
  /** связь пропала, идут повторные попытки */
  offline: boolean;
  /** короткое сообщение: отклонённое действие и т. п. */
  notice: string | null;
  act: (action: Action) => void;
  configure: (changes: { mode?: GameModeId; bots?: number }) => void;
  start: () => void;
  leave: () => Promise<void>;
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    });
  });

/**
 * Онлайн-комната (G3): вход по коду, затем long-polling — каждый ответ сервера приносит
 * свежую комнату целиком. Действия уходят POST-запросами, ответ на них — тоже новая комната.
 */
export function useRoom(code: string, name: string): RoomConnection {
  const [view, setView] = useState<RoomView | null>(null);
  const [deadline, setDeadline] = useState<number | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const version = useRef(0);

  /** Ответы могут прийти не по порядку: старую версию комнаты не показываем. */
  const apply = useCallback((next: RoomView | null) => {
    if (!next || next.version <= version.current) return;
    version.current = next.version;
    setView(next);
    setDeadline(next.deadlineIn === null ? null : Date.now() + next.deadlineIn);
  }, []);

  const report = useCallback((error: unknown) => {
    setNotice(error instanceof ApiError ? error.message : 'Не получилось, попробуйте ещё раз.');
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    const abort = new AbortController();
    const { signal } = abort;
    version.current = 0;

    const run = async () => {
      // Вход повторяется, пока нет связи; свою комнату сервер просто вернёт.
      while (!signal.aborted) {
        try {
          apply(await onlineApi.join(code, name, signal));
          saveLastRoom(code);
          setOffline(false);
          break;
        } catch (error) {
          if (signal.aborted) return;
          if (error instanceof ApiError && error.status !== 0 && error.status < 500) {
            if (error.status === 404) saveLastRoom(null);
            setFatal(error.message);
            return;
          }
          setOffline(true);
          await sleep(RETRY_MS, signal);
        }
      }
      while (!signal.aborted) {
        try {
          apply(await onlineApi.poll(code, version.current, signal));
          setOffline(false);
        } catch (error) {
          if (signal.aborted) return;
          if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
            saveLastRoom(null);
            setFatal(error.message);
            return;
          }
          setOffline(true);
          await sleep(RETRY_MS, signal);
        }
      }
    };
    void run();
    return () => abort.abort();
  }, [code, name, apply]);

  const act = useCallback(
    (action: Action) => void onlineApi.act(code, action).then(apply, report),
    [code, apply, report],
  );
  const configure = useCallback(
    (changes: { mode?: GameModeId; bots?: number }) => void onlineApi.configure(code, changes).then(apply, report),
    [code, apply, report],
  );
  const start = useCallback(() => void onlineApi.start(code).then(apply, report), [code, apply, report]);
  const leave = useCallback(async () => {
    try {
      await onlineApi.leave(code);
    } catch {
      // комнаты уже нет или нет связи — из меню всё равно уходим
    }
    saveLastRoom(null);
  }, [code]);

  return { view, deadline, fatal, offline, notice, act, configure, start, leave };
}
