import { randomInt } from 'node:crypto';
import { DEFAULT_MODE, MODES, type GameModeId } from '../shared/game/modes';
import {
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  configureRoom,
  createRoom,
  isRoomCompatible,
  joinRoom,
  leaveRoom,
  roomAction,
  roomStatus,
  roomTick,
  roomView,
  seatOf,
  startRoom,
  type Room,
  type RoomResult,
  type RoomUser,
  type RoomView,
} from '../shared/game/room';
import type { Action } from '../shared/game/types';
import type { RoomStore } from './store';

/** Комната, которая не менялась неделю, удаляется из хранилища. */
const ROOM_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Раз в столько времени из памяти выгружаются неактивные комнаты и чистится хранилище. */
const SWEEP_MS = 60 * 60 * 1000;
/** Неактивная столько времени комната выгружается из памяти (в хранилище остаётся). */
const CACHE_IDLE_MS = 30 * 60 * 1000;

export class RoomError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

interface Waiter {
  userId: string;
  /** undefined — ожидание кончилось без изменений, null — комната удалена */
  resolve: (room: Room | null | undefined) => void;
}

/**
 * Комнаты на сервере: кэш в памяти поверх хранилища, очередь изменений на каждую комнату,
 * таймеры ходов ботов и таймаутов, ожидающие long-polling запросы.
 * Правила — в src/shared/game/room.ts; здесь только хранение, время и случайность.
 * Рассчитано на один процесс Node (iisnode по умолчанию запускает один).
 */
export class RoomService {
  private cache = new Map<string, Room>();
  private queues = new Map<string, Promise<unknown>>();
  private waiters = new Map<string, Set<Waiter>>();
  private timers = new Map<string, NodeJS.Timeout>();
  private sweeper: NodeJS.Timeout;

  constructor(
    private store: RoomStore,
    private clock: () => number = Date.now,
  ) {
    this.sweeper = setInterval(() => void this.sweep().catch(logError), SWEEP_MS);
    this.sweeper.unref();
    void this.sweep().catch(logError);
  }

  get storage(): RoomStore['kind'] {
    return this.store.kind;
  }

  async create(user: RoomUser, mode: unknown, bots: unknown): Promise<RoomView> {
    const modeId = typeof mode === 'string' && mode in MODES ? (mode as GameModeId) : DEFAULT_MODE;
    const botCount = typeof bots === 'number' && Number.isFinite(bots) ? bots : 0;
    for (let attempt = 0; attempt < 10; attempt++) {
      const id = Array.from({ length: ROOM_CODE_LENGTH }, () => ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)]).join('');
      const view = await this.serial(id, async () => {
        if (await this.load(id)) return null;
        const room = createRoom({ id, host: user, mode: modeId, bots: botCount, now: this.clock() });
        await this.commit(id, room);
        return roomView(room, user.userId, this.clock());
      });
      if (view) return view;
    }
    throw new RoomError(503, 'Не удалось подобрать код комнаты, попробуйте ещё раз.');
  }

  join(id: string, user: RoomUser): Promise<RoomView> {
    return this.change(id, user.userId, (room, now) => joinRoom(room, user, now), false);
  }

  /** null — комната опустела и удалена. */
  async leave(id: string, userId: string): Promise<RoomView | null> {
    return this.serial(id, async () => {
      const room = await this.current(id);
      const result = leaveRoom(room, userId, this.clock());
      if (!result.ok) throw new RoomError(409, result.error);
      if (result.room !== room) await this.commit(id, result.room);
      return result.room ? roomView(result.room, userId, this.clock()) : null;
    });
  }

  configure(id: string, userId: string, changes: { mode?: unknown; bots?: unknown }): Promise<RoomView> {
    return this.change(id, userId, (room, now) => configureRoom(room, userId, changes, now));
  }

  start(id: string, userId: string): Promise<RoomView> {
    return this.change(id, userId, (room, now) => startRoom(room, userId, randomInt(2 ** 31), now));
  }

  act(id: string, userId: string, action: Action): Promise<RoomView> {
    return this.change(id, userId, (room, now) => roomAction(room, userId, action, now));
  }

  view(id: string, userId: string): Promise<RoomView> {
    return this.serial(id, async () => {
      const room = await this.current(id);
      this.assertMember(room, userId);
      return roomView(room, userId, this.clock());
    });
  }

  /**
   * Long-polling: сразу отдаёт комнату, если её версия новее since, иначе ждёт изменения
   * не дольше timeoutMs. null — изменений не было; signal отменяет ожидание (клиент ушёл).
   */
  async waitForChange(id: string, userId: string, since: number, timeoutMs: number, signal?: AbortSignal): Promise<RoomView | null> {
    const view = await this.view(id, userId);
    if (view.version > since) return view;
    if (signal?.aborted) return null;
    const room = await new Promise<Room | null | undefined>((resolve) => {
      const waiters = this.waiters.get(id) ?? new Set<Waiter>();
      this.waiters.set(id, waiters);
      const finish = (value: Room | null | undefined) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        waiters.delete(waiter);
        if (waiters.size === 0 && this.waiters.get(id) === waiters) this.waiters.delete(id);
        resolve(value);
      };
      const waiter: Waiter = { userId, resolve: finish };
      const onAbort = () => finish(undefined);
      const timer = setTimeout(() => finish(undefined), timeoutMs);
      signal?.addEventListener('abort', onAbort);
      waiters.add(waiter);
    });
    if (room === undefined) return null;
    if (room === null) throw new RoomError(404, 'Комната закрыта.');
    return roomView(room, userId, this.clock());
  }

  /** Останавливает таймеры (для тестов и остановки сервера). */
  async close(): Promise<void> {
    clearInterval(this.sweeper);
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    for (const waiters of this.waiters.values()) for (const waiter of waiters) waiter.resolve(undefined);
    await this.store.close();
  }

  private change(id: string, userId: string, apply: (room: Room, now: number) => RoomResult, memberOnly = true): Promise<RoomView> {
    return this.serial(id, async () => {
      const room = await this.current(id);
      if (memberOnly) this.assertMember(room, userId);
      const result = apply(room, this.clock());
      if (!result.ok) throw new RoomError(409, result.error);
      if (result.room !== room) await this.commit(id, result.room);
      return roomView(result.room, userId, this.clock());
    });
  }

  private assertMember(room: Room, userId: string): void {
    if (!room.members.some((m) => m.userId === userId) && !seatOf(room, userId)) {
      throw new RoomError(403, 'Вы не в этой комнате — войдите по коду.');
    }
  }

  /** Изменения одной комнаты идут строго по очереди, чтобы не потерять ни одно. */
  private serial<T>(id: string, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(id) ?? Promise.resolve();
    const result = previous.then(task, task);
    const tail = result.catch(() => undefined);
    this.queues.set(id, tail);
    void tail.then(() => {
      if (this.queues.get(id) === tail) this.queues.delete(id);
    });
    return result;
  }

  private async load(id: string): Promise<Room | null> {
    const cached = this.cache.get(id);
    if (cached) return cached;
    const room = await this.store.load(id);
    if (!room) return null;
    // Комната старого формата после обновления сервера не загружается.
    if (!isRoomCompatible(room)) {
      await this.store.remove(id);
      return null;
    }
    this.cache.set(id, room);
    this.schedule(room);
    return room;
  }

  /** Комната с догоняющим шагом таймера: процесс мог спать, пока шёл дедлайн. Только внутри serial. */
  private async current(id: string): Promise<Room> {
    const room = await this.load(id);
    if (!room) throw new RoomError(404, 'Комната не найдена. Проверьте код.');
    const ticked = roomTick(room, this.clock());
    if (ticked !== room) await this.commit(id, ticked);
    return ticked;
  }

  private async commit(id: string, room: Room | null): Promise<void> {
    if (room) {
      await this.store.save(room);
      this.cache.set(id, room);
    } else {
      await this.store.remove(id);
      this.cache.delete(id);
    }
    this.schedule(room ?? { id, deadline: null });
    for (const waiter of [...(this.waiters.get(id) ?? [])]) waiter.resolve(room);
  }

  private schedule(room: Pick<Room, 'id' | 'deadline'>): void {
    const { id } = room;
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    if (room.deadline === null) return;
    const timer = setTimeout(() => {
      this.timers.delete(id);
      void this.serial(id, () => this.current(id)).catch(logError);
    }, Math.max(0, room.deadline - this.clock()));
    timer.unref();
    this.timers.set(id, timer);
  }

  private async sweep(): Promise<void> {
    const now = this.clock();
    for (const [id, room] of this.cache) {
      const idle = now - room.updatedAt > CACHE_IDLE_MS;
      if (idle && !this.waiters.has(id) && (room.deadline === null || roomStatus(room) !== 'playing')) {
        this.cache.delete(id);
        this.schedule({ id, deadline: null });
      }
    }
    const removed = await this.store.purge(now - ROOM_TTL_MS);
    if (removed > 0) console.log(`Удалено старых комнат: ${removed}`);
  }
}

function logError(error: unknown): void {
  console.error(error);
}
