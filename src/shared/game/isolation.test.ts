import { describe, expect, it } from 'vitest';
import { BAIL, ISOLATION_ATTEMPTS, ISOLATION_INDEX, START_MONEY } from './board';
import { decideBotAction } from './bot';
import { applyAction, createGame, resolveRoll } from './engine';
import type { Action, GameState } from './types';

const act = (state: GameState, ...actions: Action[]) => actions.reduce(applyAction, state);

function newGame(bots = 1): GameState {
  return createGame({ playerName: 'Тест', bots, seed: 42 });
}

/** Current player sits in Isolation at the start of their turn. */
function inIsolation(state: GameState, turnsLeft = ISOLATION_ATTEMPTS): GameState {
  const player = state.players[state.currentPlayer];
  player.position = ISOLATION_INDEX;
  player.isolation = { turnsLeft };
  state.phase = 'isolation';
  return state;
}

/** Gives all ownable cells except the first `free` to p1, so the board looks like a late game. */
function occupyBoard(state: GameState, free: number): void {
  const ownable = [1, 3, 5, 6, 8, 9, 11, 12, 13, 14, 15, 16, 18, 19, 21, 23, 24, 25, 26, 27, 28, 29, 31, 32, 34, 35, 37, 39];
  for (const index of ownable.slice(free)) state.owners[index] = 'p1';
}

describe('three doubles', () => {
  it('sends the player to Isolation on the third double without moving', () => {
    const state = newGame();
    resolveRoll(state, [2, 2]); // 4 — налог
    resolveRoll(state, [3, 3]); // 10 — Изолятор, просто мимо
    expect(state.doublesInRow).toBe(2);
    expect(state.players[0].isolation).toBeNull();
    expect(state.phase).toBe('roll');

    resolveRoll(state, [1, 1]);
    expect(state.players[0].position).toBe(ISOLATION_INDEX);
    expect(state.players[0].isolation).toEqual({ turnsLeft: ISOLATION_ATTEMPTS });
    expect(state.players[0].money).toBe(START_MONEY - 200);
    expect(state.doublesInRow).toBe(0);
    expect(state.phase).toBe('end');
  });

  it('two doubles and a plain roll do not isolate; the counter resets next turn', () => {
    const state = newGame();
    resolveRoll(state, [2, 2]);
    resolveRoll(state, [3, 3]);
    resolveRoll(state, [1, 2]); // 13, свободный район
    expect(state.players[0].isolation).toBeNull();
    const after = act(state, { type: 'START_AUCTION' }, { type: 'PASS' }, { type: 'PASS' }, { type: 'END_TURN' });
    expect(after.doublesInRow).toBe(0);
    expect(after.phase).toBe('roll');
  });

  it('landing on «В Изолятор» isolates the player', () => {
    const state = newGame();
    state.players[0].position = 27;
    resolveRoll(state, [1, 2]);
    expect(state.players[0].position).toBe(ISOLATION_INDEX);
    expect(state.players[0].isolation).toEqual({ turnsLeft: ISOLATION_ATTEMPTS });
    expect(state.phase).toBe('end');
  });
});

describe('turn in Isolation', () => {
  it('starts with the isolation phase', () => {
    const state = newGame();
    state.players[0].isolation = { turnsLeft: ISOLATION_ATTEMPTS };
    state.currentPlayer = 1;
    state.phase = 'end';
    const after = applyAction(state, { type: 'END_TURN' });
    expect(after.currentPlayer).toBe(0);
    expect(after.phase).toBe('isolation');
  });

  it('a double releases and moves the player without an extra roll', () => {
    const state = inIsolation(newGame());
    resolveRoll(state, [2, 2]); // 14, свободный район
    expect(state.players[0].isolation).toBeNull();
    expect(state.players[0].position).toBe(14);
    expect(state.phase).toBe('buyDecision');
    expect(act(state, { type: 'START_AUCTION' }, { type: 'PASS' }, { type: 'PASS' }).phase).toBe('end');
  });

  it('a miss spends an attempt and keeps the player in place', () => {
    const state = inIsolation(newGame());
    resolveRoll(state, [1, 2]);
    expect(state.players[0].position).toBe(ISOLATION_INDEX);
    expect(state.players[0].isolation).toEqual({ turnsLeft: ISOLATION_ATTEMPTS - 1 });
    expect(state.players[0].money).toBe(START_MONEY);
    expect(state.phase).toBe('end');
  });

  it('after the last miss the bail is charged and the player moves', () => {
    const state = inIsolation(newGame(), 1);
    resolveRoll(state, [1, 2]);
    expect(state.players[0].isolation).toBeNull();
    expect(state.players[0].position).toBe(13);
    expect(state.players[0].money).toBe(START_MONEY - BAIL);
    expect(state.phase).toBe('buyDecision');
  });

  it('forced bail can bankrupt the player and end the game', () => {
    const state = inIsolation(newGame(), 1);
    state.players[0].money = BAIL - 1;
    state.owners[13] = 'p0';
    state.mortgaged[13] = true;
    resolveRoll(state, [1, 2]);
    expect(state.players[0].bankrupt).toBe(true);
    expect(state.players[0].isolation).toBeNull();
    expect(state.owners[13]).toBeUndefined();
    expect(state.mortgaged[13]).toBeUndefined();
    expect(state.phase).toBe('gameOver');
    expect(state.winnerId).toBe('p1');
  });

  it('ROLL works in the isolation phase through applyAction', () => {
    const after = applyAction(inIsolation(newGame()), { type: 'ROLL' });
    expect(after.dice).not.toBeNull();
    expect(after.phase).not.toBe('isolation');
  });
});

describe('PAY_BAIL', () => {
  it('charges the bail and gives a normal roll', () => {
    const after = applyAction(inIsolation(newGame()), { type: 'PAY_BAIL' });
    expect(after.players[0].money).toBe(START_MONEY - BAIL);
    expect(after.players[0].isolation).toBeNull();
    expect(after.phase).toBe('roll');
    const moved = applyAction(after, { type: 'ROLL' });
    expect(moved.players[0].position).not.toBe(ISOLATION_INDEX);
  });

  it('is ignored without enough money or outside the isolation phase', () => {
    const poor = inIsolation(newGame());
    poor.players[0].money = BAIL - 1;
    expect(applyAction(poor, { type: 'PAY_BAIL' })).toBe(poor);
    const free = newGame();
    expect(applyAction(free, { type: 'PAY_BAIL' })).toBe(free);
  });

  it('works with exactly the bail amount', () => {
    const state = inIsolation(newGame());
    state.players[0].money = BAIL;
    const after = applyAction(state, { type: 'PAY_BAIL' });
    expect(after.players[0].money).toBe(0);
    expect(after.players[0].bankrupt).toBe(false);
    expect(after.phase).toBe('roll');
  });
});

describe('USE_RELEASE_CARD', () => {
  it('releases the player and returns the card to the bottom of its deck', () => {
    const state = inIsolation(newGame());
    state.decks.net = state.decks.net.filter((id) => id !== 'net-05');
    state.players[0].releaseCards = ['net-05'];
    const after = applyAction(state, { type: 'USE_RELEASE_CARD' });
    expect(after.players[0].isolation).toBeNull();
    expect(after.players[0].releaseCards).toEqual([]);
    expect(after.players[0].money).toBe(START_MONEY);
    expect(after.decks.net.at(-1)).toBe('net-05');
    expect(after.decks.net).toHaveLength(16);
    expect(after.phase).toBe('roll');
  });

  it('is ignored without a card', () => {
    const state = inIsolation(newGame());
    expect(applyAction(state, { type: 'USE_RELEASE_CARD' })).toBe(state);
  });
});

describe('bot in Isolation', () => {
  it('uses a card early in the game', () => {
    const state = inIsolation(newGame());
    state.players[0].releaseCards = ['hack-10'];
    expect(decideBotAction(state)).toEqual({ type: 'USE_RELEASE_CARD' });
  });

  it('pays the bail early when rich enough, rolls when poor', () => {
    const state = inIsolation(newGame());
    expect(decideBotAction(state)).toEqual({ type: 'PAY_BAIL' });
    state.players[0].money = 100;
    expect(decideBotAction(state)).toEqual({ type: 'ROLL' });
  });

  it('stays in Isolation late in the game, but spends a card on the last attempt', () => {
    const state = inIsolation(newGame());
    occupyBoard(state, 2);
    state.players[0].releaseCards = ['hack-10'];
    expect(decideBotAction(state)).toEqual({ type: 'ROLL' });
    state.players[0].isolation = { turnsLeft: 1 };
    expect(decideBotAction(state)).toEqual({ type: 'USE_RELEASE_CARD' });
  });

  it('bots never get stuck and do visit Isolation', () => {
    let isolated = 0;
    for (let seed = 1; seed <= 20; seed++) {
      let state = createGame({ playerName: 'Тест', bots: 3, seed });
      for (let i = 0; i < 2000; i++) {
        const action = decideBotAction(state);
        if (!action) break;
        const next = applyAction(state, action);
        expect(next).not.toBe(state);
        if (next.phase === 'isolation') isolated++;
        state = next;
      }
    }
    expect(isolated).toBeGreaterThan(0);
  });
});
