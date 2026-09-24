import { describe, expect, it } from 'vitest';
import { ISOLATION_INDEX, START_MONEY } from './board';
import { decideBotAction } from './bot';
import { EMPTY_OFFER, netWorth } from './economy';
import { applyAction, createGame, gameResults, resolveRoll } from './engine';
import { MODES, type GameModeId } from './modes';
import { SAVE_VERSION, parseSavedGame, serializeGame } from './save';
import type { Action, GameState } from './types';

function newGame(bots = 2, mode?: GameModeId): GameState {
  return createGame({ playerName: 'Тест', bots, seed: 42, mode });
}

const act = (state: GameState, ...actions: Action[]) => actions.reduce(applyAction, state);

/** Вытягивает карточку для текущего игрока и применяет её. */
function withCard(state: GameState, id: string): GameState {
  state.phase = 'card';
  state.pendingCard = id;
  return applyAction(state, { type: 'APPLY_CARD' });
}

/** Партия одними ботами до конца. */
function playOut(state: GameState, maxActions = 20_000): GameState {
  for (let i = 0; i < maxActions && state.phase !== 'gameOver'; i++) state = applyAction(state, decideBotAction(state)!);
  return state;
}

describe('лог с категориями (F2)', () => {
  it('marks every entry with a kind and the players involved', () => {
    const state = newGame();
    expect(state.log[0]).toMatchObject({ kind: 'system', players: [] });
    state.owners[3] = 'p1';
    resolveRoll(state, [1, 2]);
    const roll = state.log.find((e) => e.text.includes('бросает'))!;
    expect(roll).toMatchObject({ kind: 'move', players: ['p0'] });
    const rent = state.log.find((e) => e.text.includes('ренту'))!;
    expect(rent).toMatchObject({ kind: 'money', players: ['p0', 'p1'] });
  });

  it('deals and bankruptcies get their own kinds', () => {
    let state = newGame();
    resolveRoll(state, [1, 2]);
    state = applyAction(state, { type: 'BUY' });
    expect(state.log.at(-1)).toMatchObject({ kind: 'deal', players: ['p0'] });

    const broke = newGame(1);
    broke.owners[3] = 'p1';
    broke.players[0].money = 2;
    resolveRoll(broke, [1, 2]);
    const out = broke.log.find((e) => e.text.includes('банкрот'))!;
    expect(out).toMatchObject({ kind: 'system', players: ['p0', 'p1'] });
  });
});

describe('перемещения для анимации (F1)', () => {
  it('a roll records a forward walk and increments rollCount', () => {
    const state = newGame();
    state.players[0].position = 38;
    resolveRoll(state, [1, 2]);
    expect(state.rollCount).toBe(1);
    expect(state.moves).toEqual([{ id: 1, playerId: 'p0', from: 38, to: 1, steps: 3 }]);
  });

  it('rolls in isolation count too, but a failed attempt does not move', () => {
    const state = newGame();
    state.players[0].position = ISOLATION_INDEX;
    state.players[0].isolation = { turnsLeft: 3 };
    resolveRoll(state, [1, 2]);
    expect(state.rollCount).toBe(1);
    expect(state.moves).toEqual([]);
  });

  it('landing on the arrest cell walks there, then jumps to Isolation', () => {
    const state = newGame();
    state.players[0].position = 25;
    resolveRoll(state, [2, 3]);
    expect(state.moves.map((m) => [m.from, m.to, m.steps])).toEqual([
      [25, 30, 5],
      [30, ISOLATION_INDEX, 0],
    ]);
  });

  it('cards: moveBy −3 walks back, moveTo walks forward through Start', () => {
    const back = newGame();
    back.players[0].position = 7;
    expect(withCard(back, 'hack-07').moves.at(-1)).toMatchObject({ from: 7, to: 4, steps: -3 });

    const forward = newGame();
    forward.players[0].position = 36;
    expect(withCard(forward, 'hack-03').moves.at(-1)).toMatchObject({ from: 36, to: 11, steps: 15 });
  });

  it('keeps only the last moves, ids keep growing', () => {
    let state = newGame(1);
    for (let i = 0; i < 40; i++) state = applyAction(state, decideBotAction(state)!);
    expect(state.moves.length).toBeLessThanOrEqual(8);
    const ids = state.moves.map((m) => m.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(ids.at(-1)).toBeGreaterThan(8);
  });
});

describe('статистика и итоги партии (F3)', () => {
  it('counts purchases, rent and peak worth', () => {
    let state = newGame();
    resolveRoll(state, [1, 2]);
    state = applyAction(state, { type: 'BUY' });
    expect(state.stats.p0.cellsBought).toBe(1);
    expect(state.stats.p0.peakWorth).toBe(START_MONEY);

    state = act(state, { type: 'END_TURN' });
    state.players[1].position = 0;
    resolveRoll(state, [1, 2]);
    expect(state.stats.p1.rentPaid).toBe(4);
    expect(state.stats.p0.rentReceived).toBe(4);
    state = act(state, { type: 'END_TURN' });
    expect(state.stats.p0.peakWorth).toBe(START_MONEY + 4);
  });

  it('rent paid from the debt phase is counted once it is paid', () => {
    const state = newGame();
    state.owners = { 1: 'p1', 3: 'p1', 5: 'p0' };
    state.buildings = { 1: 4, 3: 4 };
    state.players[0].money = 250;
    resolveRoll(state, [1, 2]);
    expect(state.phase).toBe('debt');
    expect(state.stats.p0.rentPaid).toBe(0);
    const after = act(state, { type: 'MORTGAGE', index: 5 }, { type: 'PAY_DEBT' });
    expect(after.stats.p0.rentPaid).toBe(320);
    expect(after.stats.p1.rentReceived).toBe(320);
  });

  it('counts auctions, trades, buildings and the pot', () => {
    let state = newGame();
    resolveRoll(state, [1, 2]);
    state = act(state, { type: 'START_AUCTION' }, { type: 'BID', amount: 20 }, { type: 'PASS' }, { type: 'PASS' });
    expect(state.stats.p1).toMatchObject({ auctionsWon: 1, cellsBought: 1 });

    state.owners[1] = 'p0';
    state = act(state, { type: 'PROPOSE_TRADE', trade: { from: 'p0', to: 'p1', give: { ...EMPTY_OFFER, money: 100 }, take: { ...EMPTY_OFFER, cells: [3] } } }, { type: 'ACCEPT_TRADE' });
    expect(state.stats.p0.trades).toBe(1);
    expect(state.stats.p1.trades).toBe(1);
    state = act(state, { type: 'BUILD', index: 1 });
    expect(state.stats.p0.built).toBe(1);

    const pot = newGame();
    pot.pot = 120;
    pot.players[0].position = 15;
    resolveRoll(pot, [2, 3]);
    expect(pot.stats.p0.potCollected).toBe(120);
  });

  it('last survivor: winner first, then the bankrupts from the last one out', () => {
    const state = newGame(2);
    state.owners[3] = 'p2';
    state.players[0].money = 2;
    resolveRoll(state, [1, 2]); // p0 выбывает первым
    expect(state.stats.p0.out).toEqual({ round: 1, order: 1 });
    state.currentPlayer = 1;
    state.players[1].position = 0;
    state.players[1].money = 2;
    state.phase = 'roll';
    resolveRoll(state, [1, 2]); // p1 — вторым
    expect(state.phase).toBe('gameOver');
    const results = gameResults(state);
    expect(results.map((r) => [r.place, r.player.id])).toEqual([
      [1, 'p2'],
      [2, 'p1'],
      [3, 'p0'],
    ]);
    expect(results[2].worth).toBe(0);
    expect(results[0].stats.rentReceived).toBe(0); // банкрот ренту не доплатил — это не рента
  });

  it('round limit: ranking by net worth with the winner on top', () => {
    const state = newGame(2, 'blitz');
    state.round = MODES.blitz.roundLimit!;
    state.owners[39] = 'p1';
    state.currentPlayer = 2;
    state.phase = 'end';
    const after = applyAction(state, { type: 'END_TURN' });
    expect(after.phase).toBe('gameOver');
    const results = gameResults(after);
    expect(results[0]).toMatchObject({ place: 1, player: { id: 'p1' }, worth: START_MONEY + 400 });
    expect(results.map((r) => r.player.id)).toEqual(['p1', 'p0', 'p2']);
  });

  it('a full bot game ends with consistent results', () => {
    const state = playOut(createGame({ playerName: 'Тест', bots: 3, seed: 5 }));
    expect(state.phase).toBe('gameOver');
    const results = gameResults(state);
    expect(results.map((r) => r.place)).toEqual([1, 2, 3, 4]);
    expect(results[0].player.id).toBe(state.winnerId);
    const sum = (key: 'rentPaid' | 'rentReceived') => results.reduce((s, r) => s + r.stats[key], 0);
    expect(sum('rentPaid')).toBe(sum('rentReceived'));
    for (const r of results) {
      expect(r.stats.peakWorth).toBeGreaterThanOrEqual(r.worth);
      if (r.player.bankrupt) expect(r.stats.out).not.toBeNull();
      else expect(r.worth).toBe(netWorth(state, r.player));
    }
  });
});

describe('сохранение партии (F4)', () => {
  it('round-trips a game in progress', () => {
    let state = newGame();
    state = act(state, { type: 'ROLL' });
    const saved = parseSavedGame(serializeGame(state, 1000));
    expect(saved).toEqual({ version: SAVE_VERSION, savedAt: 1000, state });
    // Партия продолжается с того же места и так же детерминированно.
    const next = decideBotAction(state)!;
    expect(applyAction(saved!.state, next)).toEqual(applyAction(state, next));
  });

  it('rejects empty, broken, foreign-version and finished saves', () => {
    const state = newGame();
    expect(parseSavedGame(null)).toBeNull();
    expect(parseSavedGame('')).toBeNull();
    expect(parseSavedGame('{not json')).toBeNull();
    expect(parseSavedGame('[]')).toBeNull();
    expect(parseSavedGame(JSON.stringify({ version: SAVE_VERSION + 1, savedAt: 1, state }))).toBeNull();
    expect(parseSavedGame(JSON.stringify({ version: SAVE_VERSION, savedAt: 1, state: { ...state, mode: 'nope' } }))).toBeNull();
    const { stats: _stats, ...old } = state;
    expect(parseSavedGame(JSON.stringify({ version: SAVE_VERSION, savedAt: 1, state: old }))).toBeNull();
    expect(parseSavedGame(serializeGame({ ...state, phase: 'gameOver', winnerId: 'p0' }, 1))).toBeNull();
  });
});
