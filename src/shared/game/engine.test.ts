import { describe, expect, it } from 'vitest';
import { decideBotAction } from './bot';
import { START_MONEY, START_SALARY } from './board';
import { applyAction, createGame, resolveRoll } from './engine';
import type { GameState } from './types';

function newGame(bots = 1): GameState {
  return createGame({ playerName: 'Тест', bots, seed: 42 });
}

describe('engine', () => {
  it('pays salary when passing Start', () => {
    const state = newGame();
    state.players[0].position = 38;
    resolveRoll(state, [1, 2]);
    expect(state.players[0].position).toBe(1);
    expect(state.players[0].money).toBe(START_MONEY + START_SALARY);
  });

  it('buying deducts price and assigns owner', () => {
    const state = newGame();
    resolveRoll(state, [1, 2]); // cell 3, price 60
    expect(state.phase).toBe('buyDecision');
    const after = applyAction(state, { type: 'BUY' });
    expect(after.owners[3]).toBe('p0');
    expect(after.players[0].money).toBe(START_MONEY - 60);
    expect(after.phase).toBe('end');
  });

  it('transfers rent to owner and doubles it for a monopoly', () => {
    const state = newGame();
    state.owners[3] = 'p1';
    resolveRoll(state, [1, 2]);
    expect(state.players[0].money).toBe(START_MONEY - 4);
    expect(state.players[1].money).toBe(START_MONEY + 4);

    const mono = newGame();
    mono.owners[1] = 'p1';
    mono.owners[3] = 'p1';
    resolveRoll(mono, [1, 2]);
    expect(mono.players[0].money).toBe(START_MONEY - 8);
  });

  it('eliminates a bankrupt player and ends the game with one left', () => {
    const state = newGame();
    state.owners[3] = 'p1';
    state.owners[39] = 'p0';
    state.mortgaged[39] = true; // заложено — денег взять неоткуда
    state.players[0].money = 2;
    resolveRoll(state, [1, 2]);
    expect(state.players[0].bankrupt).toBe(true);
    expect(state.owners[39]).toBe('p1');
    expect(state.mortgaged[39]).toBe(true);
    expect(state.players[1].money).toBe(START_MONEY + 2);
    expect(state.phase).toBe('gameOver');
    expect(state.winnerId).toBe('p1');
  });

  it('gives an extra roll on doubles', () => {
    const state = newGame();
    resolveRoll(state, [2, 2]); // cell 4, tax
    expect(state.phase).toBe('roll');
  });

  it('is deterministic for the same seed', () => {
    const play = () => {
      let state = createGame({ playerName: 'Тест', bots: 3, seed: 7 });
      for (let i = 0; i < 300; i++) {
        const action = decideBotAction(state);
        if (!action) break;
        state = applyAction(state, action);
      }
      return state;
    };
    expect(play()).toEqual(play());
  });

  it('ignores actions that do not match the phase', () => {
    const state = newGame();
    expect(applyAction(state, { type: 'BUY' })).toBe(state);
    expect(applyAction(state, { type: 'END_TURN' })).toBe(state);
  });
});
