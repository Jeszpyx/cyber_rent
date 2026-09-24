import { describe, expect, it } from 'vitest';
import { START_MONEY } from './board';
import { actingPlayer } from './economy';
import { applyAction, createGame, resolveRoll } from './engine';
import { MODES, type GameModeId } from './modes';
import {
  MAX_PLAYERS,
  configureRoom,
  createRoom,
  isRoomCompatible,
  joinRoom,
  leaveRoom,
  nextDeadline,
  normalizeName,
  normalizeRoomCode,
  parseAction,
  roomAction,
  roomStatus,
  roomTick,
  roomView,
  startRoom,
  type Room,
  type RoomResult,
  type RoomUser,
} from './room';
import { BOT_CARD_DELAY_MS, BOT_DELAY_MS, DICE_MS, JUMP_MS, STEP_MS, animationMs } from './timing';

const HOST: RoomUser = { userId: 'tg:1', name: 'Ника' };
const GUEST: RoomUser = { userId: 'g:abc', name: 'Рэй' };
const STRANGER: RoomUser = { userId: 'g:zzz', name: 'Чужой' };
const T0 = 1_000_000;

function unwrap<T>(result: RoomResult<T>): T {
  if (!result.ok) throw new Error(result.error);
  return result.room;
}

function errorOf<T>(result: RoomResult<T>): string {
  if (result.ok) throw new Error('ожидалась ошибка');
  return result.error;
}

function lobby(bots = 0, mode: GameModeId = 'classic'): Room {
  return createRoom({ id: 'ABC234', host: HOST, mode, bots, now: T0 });
}

/** Хозяин и гость (и боты) начали партию: хозяин — p0, гость — p1. */
function started(bots = 0, mode: GameModeId = 'classic'): Room {
  const room = unwrap(joinRoom(lobby(bots, mode), GUEST, T0));
  return unwrap(startRoom(room, HOST.userId, 42, T0));
}

/** Сервер дожидается дедлайна и делает шаг. */
const tick = (room: Room) => roomTick(room, room.deadline!);

describe('лобби комнаты (G2)', () => {
  it('creates a lobby with the host and clamps bots', () => {
    const room = lobby(10);
    expect(room.members).toEqual([HOST]);
    expect(room.hostId).toBe(HOST.userId);
    expect(room.bots).toBe(MAX_PLAYERS - 1);
    expect(roomStatus(room)).toBe('lobby');
    expect(isRoomCompatible(room)).toBe(true);
    expect(isRoomCompatible({ ...room, saveVersion: room.saveVersion - 1 })).toBe(false);
  });

  it('a player takes a bot seat; rejoining changes nothing', () => {
    const room = unwrap(joinRoom(lobby(3), GUEST, T0 + 5));
    expect(room.members.map((m) => m.userId)).toEqual([HOST.userId, GUEST.userId]);
    expect(room.bots).toBe(2);
    expect(room.version).toBe(2);
    expect(room.updatedAt).toBe(T0 + 5);
    expect(unwrap(joinRoom(room, GUEST, T0 + 10))).toBe(room);
  });

  it('numbers duplicate names', () => {
    const room = unwrap(joinRoom(lobby(), { userId: 'g:2', name: HOST.name }, T0));
    expect(room.members[1].name).toBe(`${HOST.name} 2`);
  });

  it('rejects joining a full room or a started game', () => {
    let room = lobby();
    for (let i = 1; i < MAX_PLAYERS; i++) room = unwrap(joinRoom(room, { userId: `g:${i}`, name: `Игрок ${i}` }, T0));
    expect(errorOf(joinRoom(room, STRANGER, T0))).toMatch(/заполнена/);
    expect(errorOf(joinRoom(started(), STRANGER, T0))).toMatch(/уже идёт/);
    // Свой игрок в идущую партию возвращается без ошибки.
    const game = started();
    expect(unwrap(joinRoom(game, GUEST, T0))).toBe(game);
  });

  it('host leaves — the next player becomes host; the last one deletes the room', () => {
    const room = unwrap(joinRoom(lobby(), GUEST, T0));
    const left = unwrap(leaveRoom(room, HOST.userId, T0))!;
    expect(left.hostId).toBe(GUEST.userId);
    expect(left.members).toEqual([GUEST]);
    expect(unwrap(leaveRoom(left, GUEST.userId, T0))).toBeNull();
    expect(errorOf(leaveRoom(started(), GUEST.userId, T0))).toMatch(/уже идёт/);
  });

  it('only the host configures, bots are clamped by free seats', () => {
    const room = unwrap(joinRoom(lobby(), GUEST, T0));
    expect(errorOf(configureRoom(room, GUEST.userId, { bots: 1 }, T0))).toMatch(/хозяин/);
    expect(errorOf(configureRoom(room, HOST.userId, { mode: 'monopoly' }, T0))).toMatch(/режима/);
    expect(errorOf(configureRoom(room, HOST.userId, { bots: 'много' }, T0))).toMatch(/ботов/);
    const configured = unwrap(configureRoom(room, HOST.userId, { mode: 'blitz', bots: 9 }, T0));
    expect(configured.mode).toBe('blitz');
    expect(configured.bots).toBe(MAX_PLAYERS - 2);
    expect(unwrap(configureRoom(room, HOST.userId, { bots: -3 }, T0)).bots).toBe(0);
  });
});

describe('старт партии в комнате (G2)', () => {
  it('needs the host and at least two players', () => {
    expect(errorOf(startRoom(lobby(), HOST.userId, 1, T0))).toMatch(/два игрока/);
    const room = unwrap(joinRoom(lobby(), GUEST, T0));
    expect(errorOf(startRoom(room, GUEST.userId, 1, T0))).toMatch(/хозяин/);
    expect(unwrap(startRoom(lobby(1), HOST.userId, 1, T0)).state!.players).toHaveLength(2);
  });

  it('seats humans first in join order, then bots', () => {
    const room = started(2);
    const players = room.state!.players;
    expect(players.map((p) => [p.name, p.isBot])).toEqual([
      [HOST.name, false],
      [GUEST.name, false],
      ['Бот Глитч', true],
      ['Бот Неон', true],
    ]);
    expect(room.seats).toEqual({ p0: HOST.userId, p1: GUEST.userId });
    expect(roomStatus(room)).toBe('playing');
    expect(room.deadline).toBe(T0 + MODES.classic.turnSeconds! * 1000);
    expect(errorOf(startRoom(room, HOST.userId, 1, T0))).toMatch(/уже началась/);
  });

  it('the same seed gives the same game', () => {
    const a = started();
    const b = started();
    const roll = (room: Room) => unwrap(roomAction(room, HOST.userId, { type: 'ROLL' }, T0)).state;
    expect(roll(a)).toEqual(roll(b));
  });
});

describe('действия игроков в комнате (G2)', () => {
  it('only the acting player can act', () => {
    const room = started();
    expect(errorOf(roomAction(room, GUEST.userId, { type: 'ROLL' }, T0))).toMatch(/Сейчас решает Ника/);
    expect(errorOf(roomAction(room, STRANGER.userId, { type: 'ROLL' }, T0))).toMatch(/не играете/);
    expect(errorOf(roomAction(room, HOST.userId, { type: 'TIMEOUT' }, T0))).toMatch(/сервер/);
    expect(errorOf(roomAction(room, HOST.userId, { type: 'END_TURN' }, T0))).toMatch(/недоступно/);

    const next = unwrap(roomAction(room, HOST.userId, { type: 'ROLL' }, T0 + 100));
    expect(next.version).toBe(room.version + 1);
    expect(next.state!.rollCount).toBe(1);
  });

  it('the auction participant decides even when it is not their turn', () => {
    const room = started();
    const state = structuredClone(room.state!);
    state.phase = 'auction';
    state.auction = { index: 1, bid: 0, leaderId: null, queue: ['p1', 'p0'] };
    const auction = { ...room, state };
    expect(errorOf(roomAction(auction, HOST.userId, { type: 'BID', amount: 10 }, T0))).toMatch(/Рэй/);
    const next = unwrap(roomAction(auction, GUEST.userId, { type: 'BID', amount: 10 }, T0));
    expect(next.state!.auction!.leaderId).toBe('p1');
    expect(actingPlayer(next.state!).id).toBe('p0');
  });

  it('the deadline waits for the move animation', () => {
    const room = started();
    const next = unwrap(roomAction(room, HOST.userId, { type: 'ROLL' }, T0));
    const anim = animationMs(room.state!, next.state!);
    expect(anim).toBeGreaterThanOrEqual(DICE_MS + 2 * STEP_MS);
    const seconds = actingPlayer(next.state!).isBot ? 0 : MODES.classic.turnSeconds! * 1000;
    expect(next.deadline).toBe(T0 + anim + seconds);
  });

  it('rejects actions after the game is over', () => {
    const room = started();
    const state = structuredClone(room.state!);
    state.phase = 'gameOver';
    const over = { ...room, state };
    expect(roomStatus(over)).toBe('finished');
    expect(errorOf(roomAction(over, HOST.userId, { type: 'ROLL' }, T0))).toMatch(/окончена/);
    const ticked = roomTick({ ...over, deadline: T0 }, T0 + 1);
    expect(ticked.state).toBe(state);
    expect(ticked.deadline).toBeNull();
  });
});

describe('таймер сервера и боты (G2)', () => {
  it('does nothing before the deadline', () => {
    const room = started();
    expect(roomTick(room, room.deadline! - 1)).toBe(room);
    expect(roomTick(unwrap(joinRoom(lobby(), GUEST, T0)), T0 + 10 ** 9).state).toBeNull();
  });

  it('a silent player is fined, the bot acts for them, and after the limit takes over', () => {
    let room = started();
    const { idleFine, idleStrikesLimit } = MODES.classic;
    room = tick(room);
    expect(room.state!.players[0].idleStrikes).toBe(1);
    expect(room.state!.log.some((e) => e.text.includes(`штраф ${idleFine}₵`))).toBe(true);
    // За молчащего игрока бот бросил кубики.
    expect(room.state!.rollCount).toBe(1);

    // Дальше тикаем, пока игрок не молчит idleStrikesLimit раз подряд.
    for (let i = 0; i < 200 && !room.state!.players[0].isBot; i++) room = tick(room);
    expect(room.state!.players[0].isBot).toBe(true);
    expect(room.state!.players[0].idleStrikes).toBeGreaterThanOrEqual(idleStrikesLimit);
  });

  it('a player taken over by the bot gets control back only for their own token', () => {
    const room = started();
    const state = structuredClone(room.state!);
    state.players[0].isBot = true;
    const botted = { ...room, state };
    expect(errorOf(roomAction(botted, HOST.userId, { type: 'ROLL' }, T0))).toMatch(/управляет бот/);
    expect(errorOf(roomAction(botted, GUEST.userId, { type: 'TAKE_CONTROL', playerId: 'p0' }, T0))).toMatch(/свою/);
    expect(errorOf(roomAction(botted, GUEST.userId, { type: 'TAKE_CONTROL', playerId: 'p1' }, T0))).toMatch(/недоступно/);
    const back = unwrap(roomAction(botted, HOST.userId, { type: 'TAKE_CONTROL', playerId: 'p0' }, T0));
    expect(back.state!.players[0].isBot).toBe(false);
    // Теперь снова решает человек: дедлайн — время режима, а не пауза бота.
    expect(back.deadline).toBe(T0 + MODES.classic.turnSeconds! * 1000);
  });

  it('bots move after a short pause; a drawn card is held longer', () => {
    const room = unwrap(startRoom(lobby(1), HOST.userId, 7, T0));
    const state = structuredClone(room.state!);
    state.currentPlayer = 1;
    const botTurn = { ...room, state, deadline: T0 };
    const next = roomTick(botTurn, T0);
    expect(next.state!.rollCount).toBe(1);
    if (actingPlayer(next.state!).isBot) {
      expect(next.deadline).toBe(T0 + animationMs(state, next.state!) + (next.state!.phase === 'card' ? BOT_CARD_DELAY_MS : BOT_DELAY_MS));
    }

    const card = structuredClone(state);
    card.phase = 'card';
    card.pendingCard = card.decks.hack[0];
    expect(nextDeadline(null, card, T0)).toBe(T0 + BOT_CARD_DELAY_MS);
    expect(nextDeadline(null, { ...card, phase: 'end' }, T0)).toBe(T0 + BOT_DELAY_MS);
    expect(roomTick({ ...botTurn, state: card }, T0).state!.phase).not.toBe('card');
    // Бот завершил ход — очередь человека, у него полное время режима.
    const ended = roomTick({ ...botTurn, state: { ...state, phase: 'end' } }, T0);
    expect(ended.state!.currentPlayer).toBe(0);
    expect(ended.deadline).toBe(T0 + MODES.classic.turnSeconds! * 1000);
  });

  it('a room of silent players plays to the end on its own', () => {
    let room = started(2, 'blitz');
    for (let i = 0; i < 50_000 && roomStatus(room) === 'playing'; i++) room = tick(room);
    expect(roomStatus(room)).toBe('finished');
    expect(room.deadline).toBeNull();
    expect(room.state!.winnerId).not.toBeNull();
    expect(room.state!.players.slice(0, 2).every((p) => p.isBot || p.bankrupt)).toBe(true);
  });

  it('a bankrupt player cannot act or take control', () => {
    const room = started(1);
    const state = structuredClone(room.state!);
    state.players[1].bankrupt = true;
    state.players[1].isBot = true;
    const out = { ...room, state };
    expect(errorOf(roomAction(out, GUEST.userId, { type: 'TAKE_CONTROL', playerId: 'p1' }, T0))).toMatch(/недоступно/);
    expect(errorOf(roomAction(out, GUEST.userId, { type: 'ROLL' }, T0))).toMatch(/Сейчас решает/);
  });
});

describe('вид комнаты для клиента (G3)', () => {
  it('shows names, the own seat and time left, but never user ids', () => {
    const room = started(1);
    const view = roomView(room, GUEST.userId, T0 + 1000);
    expect(view).toMatchObject({ id: 'ABC234', status: 'playing', hostName: HOST.name, isHost: false, you: 'p1', bots: 1 });
    expect(view.members).toEqual([HOST.name, GUEST.name]);
    expect(view.deadlineIn).toBe(room.deadline! - T0 - 1000);
    expect(roomView(room, HOST.userId, room.deadline! + 5).deadlineIn).toBe(0);
    expect(roomView(room, STRANGER.userId, T0).you).toBeNull();
    const json = JSON.stringify(view);
    expect(json).not.toContain(HOST.userId);
    expect(json).not.toContain(GUEST.userId);
  });
});

describe('разбор данных из сети', () => {
  it('parses known actions and drops extra fields', () => {
    expect(parseAction({ type: 'ROLL', extra: 1 })).toEqual({ type: 'ROLL' });
    expect(parseAction({ type: 'BID', amount: 30 })).toEqual({ type: 'BID', amount: 30 });
    expect(parseAction({ type: 'BUILD', index: 39 })).toEqual({ type: 'BUILD', index: 39 });
    expect(parseAction({ type: 'TAKE_CONTROL', playerId: 'p1' })).toEqual({ type: 'TAKE_CONTROL', playerId: 'p1' });
    const trade = { from: 'p0', to: 'p1', give: { cells: [1], money: 0, releaseCards: [] }, take: { cells: [], money: 50, releaseCards: ['h1'] } };
    expect(parseAction({ type: 'PROPOSE_TRADE', trade: { ...trade, resume: 'end' } })).toEqual({ type: 'PROPOSE_TRADE', trade });
  });

  it('rejects malformed actions', () => {
    for (const raw of [
      null,
      'ROLL',
      [],
      { type: 'HACK_THE_BANK' },
      { type: 'BID', amount: '10' },
      { type: 'BID', amount: 10.5 },
      { type: 'BUILD', index: 40 },
      { type: 'MORTGAGE', index: -1 },
      { type: 'TAKE_CONTROL' },
      { type: 'PROPOSE_TRADE', trade: { from: 'p0', to: 'p1', give: { cells: [1] }, take: { cells: [], money: 0, releaseCards: [] } } },
      { type: 'PROPOSE_TRADE', trade: { from: 'p0', to: 'p1', give: { cells: ['1'], money: 0, releaseCards: [] }, take: { cells: [], money: 0, releaseCards: [] } } },
    ]) {
      expect(parseAction(raw)).toBeNull();
    }
  });

  it('normalizes names and room codes', () => {
    expect(normalizeName('  Нео \n  Андерсон ')).toBe('Нео Андерсон');
    expect(normalizeName('x'.repeat(50))).toHaveLength(20);
    expect(normalizeName('   ')).toBeNull();
    expect(normalizeName(42)).toBeNull();
    expect(normalizeRoomCode(' abc234 ')).toBe('ABC234');
    expect(normalizeRoomCode('ABC23O')).toBeNull(); // O путается с 0
    expect(normalizeRoomCode('ABC')).toBeNull();
  });
});

describe('движок для онлайна', () => {
  it('creates a game with several humans; the start bonus goes to the first', () => {
    const state = createGame({ playerName: 'не используется', humanNames: ['А', 'Б', 'В'], bots: 1, seed: 1, startBonus: 100 });
    expect(state.players.map((p) => [p.id, p.name, p.isBot])).toEqual([
      ['p0', 'А', false],
      ['p1', 'Б', false],
      ['p2', 'В', false],
      ['p3', 'Бот Глитч', true],
    ]);
    expect(new Set(state.players.map((p) => p.color)).size).toBe(4);
    expect(state.players.map((p) => p.money)).toEqual([START_MONEY + 100, START_MONEY, START_MONEY, START_MONEY]);
  });

  it('TAKE_CONTROL returns a taken-over player, but not the bankrupt or after the end', () => {
    const state = createGame({ playerName: 'Тест', bots: 1, seed: 1 });
    state.players[0].isBot = true;
    state.players[0].idleStrikes = 3;
    const back = applyAction(state, { type: 'TAKE_CONTROL', playerId: 'p0' });
    expect(back.players[0]).toMatchObject({ isBot: false, idleStrikes: 0 });
    expect(back.log.at(-1)!.kind).toBe('system');
    expect(back.phase).toBe(state.phase);
    expect(applyAction(back, { type: 'TAKE_CONTROL', playerId: 'p0' })).toBe(back);
    expect(applyAction(back, { type: 'TAKE_CONTROL', playerId: 'nobody' })).toBe(back);
    expect(applyAction({ ...state, phase: 'gameOver' }, { type: 'TAKE_CONTROL', playerId: 'p0' }).players[0].isBot).toBe(true);
    const broke = structuredClone(state);
    broke.players[0].bankrupt = true;
    expect(applyAction(broke, { type: 'TAKE_CONTROL', playerId: 'p0' })).toBe(broke);
  });

  it('estimates the move animation', () => {
    const prev = createGame({ playerName: 'Тест', bots: 1, seed: 1 });
    const next = structuredClone(prev);
    resolveRoll(next, [3, 4]);
    expect(next.moves).toHaveLength(1);
    expect(animationMs(prev, next)).toBe(DICE_MS + 7 * STEP_MS);
    expect(animationMs(next, next)).toBe(0);
    const jailed = structuredClone(next);
    resolveRoll(jailed, [6, 6]);
    jailed.moves.push({ id: jailed.moves.at(-1)!.id + 1, playerId: 'p0', from: 19, to: 10, steps: 0 });
    expect(animationMs(next, jailed)).toBe(DICE_MS + 12 * STEP_MS + JUMP_MS);
  });
});
