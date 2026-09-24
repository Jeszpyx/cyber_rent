import { BOARD } from './board';
import { decideBotAction } from './bot';
import { actingPlayer } from './economy';
import { MAX_PLAYERS, applyAction, createGame } from './engine';
import { MODES, type GameModeId } from './modes';
import { SAVE_VERSION } from './save';
import { animationMs, botDelayMs } from './timing';
import type { Action, GameState, Trade, TradeOffer } from './types';

/**
 * Онлайн-комната: лобби, места живых игроков и партия. Чистые функции без Node API:
 * сервер хранит Room, вызывает эти функции и рассылает roomView. Случайность (код комнаты, seed)
 * и текущее время передаёт вызывающий.
 */

/** Код комнаты: без похожих символов (0/O, 1/I), чтобы его можно было продиктовать. */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 6;
export const NAME_MAX_LENGTH = 20;
export const MIN_PLAYERS = 2;
export { MAX_PLAYERS };

export interface RoomUser {
  /** 'tg:<telegram id>' или 'g:<хэш гостевого токена>'; клиентам не отправляется */
  userId: string;
  name: string;
}

export type RoomStatus = 'lobby' | 'playing' | 'finished';

export interface Room {
  id: string;
  /** SAVE_VERSION на момент записи: комната старого формата после обновления не загружается */
  saveVersion: number;
  /** растёт на 1 с каждым изменением: клиент ждёт версию больше своей */
  version: number;
  hostId: string;
  mode: GameModeId;
  /** ботов за столом; меняется только в лобби */
  bots: number;
  /** живые игроки по порядку хода */
  members: RoomUser[];
  /** player id → userId живого игрока; заполняется при старте */
  seats: Record<string, string>;
  /** null — лобби, партия ещё не началась */
  state: GameState | null;
  /** когда сервер сам сделает шаг (ms since epoch): ход бота или TIMEOUT живого игрока; null — ждать нечего */
  deadline: number | null;
  createdAt: number;
  updatedAt: number;
}

/** Комната глазами одного пользователя — это отправляется клиенту. */
export interface RoomView {
  id: string;
  version: number;
  status: RoomStatus;
  mode: GameModeId;
  bots: number;
  hostName: string;
  isHost: boolean;
  /** имена живых игроков по порядку хода */
  members: string[];
  state: GameState | null;
  /** id фишки этого пользователя; null — не играет в этой партии */
  you: string | null;
  /** сколько ms осталось до шага сервера (ход бота или таймаут); null — не ждём */
  deadlineIn: number | null;
}

export type RoomResult<T = Room> = { ok: true; room: T } | { ok: false; error: string };

const ok = <T>(room: T): RoomResult<T> => ({ ok: true, room });
const fail = <T = Room>(error: string): RoomResult<T> => ({ ok: false, error });

function touch(room: Room, changes: Partial<Room>, now: number): Room {
  return { ...room, ...changes, version: room.version + 1, updatedAt: now };
}

export function roomStatus(room: Room): RoomStatus {
  if (!room.state) return 'lobby';
  return room.state.phase === 'gameOver' ? 'finished' : 'playing';
}

export function isRoomCompatible(room: Room): boolean {
  return room.saveVersion === SAVE_VERSION;
}

/** Имя игрока: без управляющих символов и лишних пробелов, не длиннее NAME_MAX_LENGTH; null — пустое. */
export function normalizeName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX_LENGTH).trim();
  return name || null;
}

/** Код комнаты из ввода игрока или ссылки; null — такого кода быть не может. */
export function normalizeRoomCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.trim().toUpperCase();
  if (code.length !== ROOM_CODE_LENGTH) return null;
  return [...code].every((c) => ROOM_CODE_ALPHABET.includes(c)) ? code : null;
}

/** Одинаковые имена за столом различаются номером: «Игрок», «Игрок 2». */
function uniqueName(members: RoomUser[], name: string): string {
  const taken = new Set(members.map((m) => m.name));
  if (!taken.has(name)) return name;
  for (let n = 2; ; n++) {
    const candidate = `${name.slice(0, NAME_MAX_LENGTH - String(n).length - 1)} ${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

function clampBots(bots: number, members: number): number {
  return Math.max(0, Math.min(Math.trunc(bots), MAX_PLAYERS - members));
}

export interface CreateRoomOptions {
  id: string;
  host: RoomUser;
  mode: GameModeId;
  bots: number;
  now: number;
}

export function createRoom({ id, host, mode, bots, now }: CreateRoomOptions): Room {
  return {
    id,
    saveVersion: SAVE_VERSION,
    version: 1,
    hostId: host.userId,
    mode,
    bots: clampBots(bots, 1),
    members: [host],
    seats: {},
    state: null,
    deadline: null,
    createdAt: now,
    updatedAt: now,
  };
}

/** Вход в лобби. Повторный вход своего игрока ничего не меняет — так клиент возвращается в комнату. */
export function joinRoom(room: Room, user: RoomUser, now: number): RoomResult {
  if (room.members.some((m) => m.userId === user.userId)) return ok(room);
  if (room.state) return fail('Партия в этой комнате уже идёт.');
  if (room.members.length >= MAX_PLAYERS) return fail('Комната заполнена.');
  const members = [...room.members, { ...user, name: uniqueName(room.members, user.name) }];
  // Живой игрок занимает место бота.
  return ok(touch(room, { members, bots: clampBots(room.bots, members.length) }, now));
}

/** Выход из лобби. Хозяином становится следующий игрок; опустевшая комната удаляется (room: null). */
export function leaveRoom(room: Room, userId: string, now: number): RoomResult<Room | null> {
  if (room.state) return fail('Партия уже идёт: из неё можно просто выйти в меню и вернуться позже.');
  if (!room.members.some((m) => m.userId === userId)) return ok(room);
  const members = room.members.filter((m) => m.userId !== userId);
  if (members.length === 0) return ok(null);
  const hostId = room.hostId === userId ? members[0].userId : room.hostId;
  return ok(touch(room, { members, hostId }, now));
}

/** Хозяин в лобби меняет режим и число ботов. */
export function configureRoom(room: Room, userId: string, changes: { mode?: unknown; bots?: unknown }, now: number): RoomResult {
  if (room.hostId !== userId) return fail('Настраивать комнату может только её хозяин.');
  if (room.state) return fail('Партия уже началась.');
  const mode = changes.mode === undefined ? room.mode : changes.mode;
  if (typeof mode !== 'string' || !(mode in MODES)) return fail('Нет такого режима.');
  const bots = changes.bots === undefined ? room.bots : changes.bots;
  if (typeof bots !== 'number' || !Number.isFinite(bots)) return fail('Неверное число ботов.');
  return ok(touch(room, { mode: mode as GameModeId, bots: clampBots(bots, room.members.length) }, now));
}

/** Хозяин начинает партию: живые игроки ходят первыми в порядке входа, за ними боты. */
export function startRoom(room: Room, userId: string, seed: number, now: number): RoomResult {
  if (room.hostId !== userId) return fail('Начать партию может только хозяин комнаты.');
  if (room.state) return fail('Партия уже началась.');
  if (room.members.length + room.bots < MIN_PLAYERS) return fail('Нужно хотя бы два игрока: позовите друга или добавьте бота.');
  const state = createGame({
    playerName: room.members[0].name,
    humanNames: room.members.map((m) => m.name),
    bots: room.bots,
    seed,
    mode: room.mode,
  });
  const seats = Object.fromEntries(room.members.map((m, i) => [state.players[i].id, m.userId]));
  return ok(touch(room, { state, seats, deadline: nextDeadline(null, state, now) }, now));
}

/** id фишки пользователя в партии; null — он в ней не играет. */
export function seatOf(room: Room, userId: string): string | null {
  return Object.keys(room.seats).find((playerId) => room.seats[playerId] === userId) ?? null;
}

/**
 * Action от пользователя. Решать может только тот, чья фишка сейчас actingPlayer
 * (должник, участник торгов, адресат обмена или текущий игрок), и только если ею не управляет бот.
 */
export function roomAction(room: Room, userId: string, action: Action, now: number): RoomResult {
  const state = room.state;
  if (!state) return fail('Партия ещё не началась.');
  if (state.phase === 'gameOver') return fail('Партия окончена.');
  const seat = seatOf(room, userId);
  if (!seat) return fail('Вы не играете в этой партии.');
  if (action.type === 'TIMEOUT') return fail('Время хода считает сервер.');
  if (action.type === 'TAKE_CONTROL') {
    if (action.playerId !== seat) return fail('Вернуть можно только свою фишку.');
  } else {
    const actor = actingPlayer(state);
    if (actor.id !== seat) return fail(`Сейчас решает ${actor.name}.`);
    if (actor.isBot) return fail('Вашей фишкой управляет бот — сначала верните управление.');
  }
  const next = applyAction(state, action);
  if (next === state) return fail('Это действие сейчас недоступно.');
  return ok(advance(room, next, now));
}

/**
 * Шаг сервера по таймеру: ход бота или TIMEOUT живого игрока (штраф, затем за него решает бот).
 * До дедлайна комната возвращается как есть (тот же объект).
 */
export function roomTick(room: Room, now: number): Room {
  const state = room.state;
  if (!state || room.deadline === null || now < room.deadline) return room;
  const actor = actingPlayer(state);
  const action: Action | null = actor.isBot ? decideBotAction(state) : { type: 'TIMEOUT' };
  const next = action ? applyAction(state, action) : state;
  // Бот не нашёл хода — ждать нечего, иначе таймер крутился бы вхолостую.
  if (next === state) return touch(room, { deadline: null }, now);
  return advance(room, next, now);
}

function advance(room: Room, next: GameState, now: number): Room {
  return touch(room, { state: next, deadline: nextDeadline(room.state, next, now) }, now);
}

/**
 * Когда сервер сделает следующий шаг: боту — пауза после анимации хода,
 * живому игроку — время режима на решение плюс та же анимация.
 */
export function nextDeadline(prev: GameState | null, next: GameState, now: number): number | null {
  if (next.phase === 'gameOver') return null;
  const wait = prev ? animationMs(prev, next) : 0;
  if (actingPlayer(next).isBot) return now + wait + botDelayMs(next);
  const seconds = MODES[next.mode].turnSeconds;
  return seconds === null ? null : now + wait + seconds * 1000;
}

export function roomView(room: Room, userId: string, now: number): RoomView {
  const host = room.members.find((m) => m.userId === room.hostId);
  return {
    id: room.id,
    version: room.version,
    status: roomStatus(room),
    mode: room.mode,
    bots: room.bots,
    hostName: host?.name ?? '',
    isHost: room.hostId === userId,
    members: room.members.map((m) => m.name),
    state: room.state,
    you: seatOf(room, userId),
    deadlineIn: room.deadline === null ? null : Math.max(0, room.deadline - now),
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isInt = (value: unknown): value is number => Number.isInteger(value);
const isCellIndex = (value: unknown): value is number => isInt(value) && value >= 0 && value < BOARD.length;
const isId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 64;

function parseOffer(raw: unknown): TradeOffer | null {
  if (!isRecord(raw) || !isInt(raw.money)) return null;
  const { cells, releaseCards } = raw;
  if (!Array.isArray(cells) || cells.length > BOARD.length || !cells.every(isCellIndex)) return null;
  if (!Array.isArray(releaseCards) || releaseCards.length > 8 || !releaseCards.every(isId)) return null;
  return { cells: [...cells], money: raw.money, releaseCards: [...releaseCards] };
}

function parseTrade(raw: unknown): Trade | null {
  if (!isRecord(raw) || !isId(raw.from) || !isId(raw.to)) return null;
  const give = parseOffer(raw.give);
  const take = parseOffer(raw.take);
  return give && take ? { from: raw.from, to: raw.to, give, take } : null;
}

/**
 * Action из сети: только известные типы с полями правильной формы, лишнее отбрасывается.
 * Допустимо ли действие по правилам, решает движок.
 */
export function parseAction(raw: unknown): Action | null {
  if (!isRecord(raw)) return null;
  switch (raw.type) {
    case 'ROLL':
    case 'BUY':
    case 'START_AUCTION':
    case 'PASS':
    case 'APPLY_CARD':
    case 'PAY_BAIL':
    case 'USE_RELEASE_CARD':
    case 'PAY_DEBT':
    case 'DECLARE_BANKRUPTCY':
    case 'ACCEPT_TRADE':
    case 'REJECT_TRADE':
    case 'END_TURN':
    case 'TIMEOUT':
      return { type: raw.type };
    case 'BID':
      return isInt(raw.amount) ? { type: 'BID', amount: raw.amount } : null;
    case 'BUILD':
    case 'SELL_BUILDING':
    case 'MORTGAGE':
    case 'UNMORTGAGE':
      return isCellIndex(raw.index) ? { type: raw.type, index: raw.index } : null;
    case 'PROPOSE_TRADE': {
      const trade = parseTrade(raw.trade);
      return trade ? { type: 'PROPOSE_TRADE', trade } : null;
    }
    case 'TAKE_CONTROL':
      return isId(raw.playerId) ? { type: 'TAKE_CONTROL', playerId: raw.playerId } : null;
    default:
      return null;
  }
}

/** GET /api/config: что клиент узнаёт о сервере до входа. */
export interface ServerConfig {
  /** username бота и short name Mini App для ссылки t.me/<bot>/<app>?startapp=<код>; null — ссылка на сайт */
  telegramApp: { bot: string; app: string } | null;
}
