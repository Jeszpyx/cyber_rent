import { describe, expect, it } from 'vitest';
import { BAIL, BOARD, ISOLATION_INDEX, START_MONEY, START_SALARY, TOWER_LEVEL } from './board';
import { decideBotAction } from './bot';
import { availableBonus, claimBonus, DAILY_BONUS_STEPS, spendBonus } from './dailyBonus';
import { netWorth, rentMultiplier } from './economy';
import { applyAction, calculateRent, createGame, resolveRoll, standings } from './engine';
import { MODES, type GameModeId } from './modes';
import type { Action, GameState, OwnableCell } from './types';

const NEUTRAL_INDEX = BOARD.findIndex((c) => c.kind === 'neutral');

function newGame(bots = 1, mode: GameModeId = 'classic'): GameState {
  return createGame({ playerName: 'Тест', bots, seed: 42, mode });
}

const act = (state: GameState, ...actions: Action[]) => actions.reduce(applyAction, state);

/** Текущий игрок завершает ход — очередь переходит к следующему. */
function endTurn(state: GameState): GameState {
  return applyAction({ ...state, phase: 'end', rolledDouble: false }, { type: 'END_TURN' });
}

/** Прогоняет партию одними ботами (человек тоже ходит через decideBotAction). */
function playOut(state: GameState, maxActions = 200_000): GameState {
  for (let i = 0; i < maxActions && state.phase !== 'gameOver'; i++) {
    state = applyAction(state, decideBotAction(state)!);
  }
  return state;
}

describe('Нейтральная зона (D1)', () => {
  it('tax goes to the pot, landing on the zone collects it', () => {
    const state = newGame();
    resolveRoll(state, [1, 3]); // 4 — налог 200
    expect(state.pot).toBe(200);
    expect(state.players[0].money).toBe(START_MONEY - 200);

    state.players[1].position = NEUTRAL_INDEX - 5;
    state.currentPlayer = 1;
    resolveRoll(state, [1, 4]);
    expect(state.players[1].position).toBe(NEUTRAL_INDEX);
    expect(state.players[1].money).toBe(START_MONEY + 200);
    expect(state.pot).toBe(0);
    expect(state.phase).toBe('end');
  });

  it('empty pot gives nothing', () => {
    const state = newGame();
    state.players[0].position = NEUTRAL_INDEX - 3;
    resolveRoll(state, [1, 2]);
    expect(state.players[0].money).toBe(START_MONEY);
    expect(state.log.at(-1)!.text).toContain('пуста');
  });

  it('bail and card fines go to the pot, rent does not', () => {
    let state = newGame();
    state.players[0].position = ISOLATION_INDEX;
    state.players[0].isolation = { turnsLeft: 3 };
    state.phase = 'isolation';
    state = applyAction(state, { type: 'PAY_BAIL' });
    expect(state.pot).toBe(BAIL);

    state = newGame();
    state.decks.hack = ['hack-14', ...state.decks.hack.filter((id) => id !== 'hack-14')];
    state.players[0].position = 4;
    resolveRoll(state, [1, 2]); // 7 — «Взлом»
    state = applyAction(state, { type: 'APPLY_CARD' });
    expect(state.pot).toBe(15);

    state = newGame();
    state.owners[1] = 'p1';
    resolveRoll(state, [0, 1] as [number, number]);
    expect(state.players[1].money).toBe(START_MONEY + 2);
    expect(state.pot).toBe(0);
  });

  it('a fine paid from the debt phase lands in the pot', () => {
    let state = newGame();
    state.players[0].money = 150;
    state.owners[5] = 'p0';
    resolveRoll(state, [1, 3]); // налог 200, наличных 150 + залог станции 100
    expect(state.phase).toBe('debt');
    state = act(state, { type: 'MORTGAGE', index: 5 }, { type: 'PAY_DEBT' });
    expect(state.pot).toBe(200);
    expect(state.players[0].money).toBe(50);
  });

  it('bankruptcy before the bank leaves the pot as it was', () => {
    const state = newGame(2);
    state.pot = 70;
    state.players[0].money = 10;
    resolveRoll(state, [1, 3]); // налог 200, имущества нет
    expect(state.players[0].bankrupt).toBe(true);
    expect(state.pot).toBe(70);
  });
});

describe('таймаут хода (D2)', () => {
  it('fines the player into the pot and lets the bot act for them', () => {
    const state = applyAction(newGame(), { type: 'TIMEOUT' });
    expect(state.pot).toBe(MODES.classic.idleFine);
    expect(state.players[0].idleStrikes).toBe(1);
    expect(state.dice).not.toBeNull(); // бот бросил кубики за игрока
    expect(state.players[0].isBot).toBe(false);
  });

  it('never fines more than the cash on hand and never below zero', () => {
    let state = newGame();
    state.players[0].money = 20;
    state.phase = 'end';
    state = applyAction(state, { type: 'TIMEOUT' });
    expect(state.players[0].money).toBe(0);
    expect(state.pot).toBe(20);
    expect(state.currentPlayer).toBe(1);

    state = newGame();
    state.players[0].money = 0;
    state.phase = 'end';
    state = applyAction(state, { type: 'TIMEOUT' });
    expect(state.players[0].money).toBe(0);
    expect(state.players[0].bankrupt).toBe(false);
    expect(state.pot).toBe(0);
  });

  it('own action resets the strike counter', () => {
    let state = newGame();
    state = applyAction(state, { type: 'TIMEOUT' });
    expect(state.players[0].idleStrikes).toBe(1);
    state = applyAction({ ...state, phase: 'end', rolledDouble: false }, { type: 'END_TURN' });
    expect(state.players[0].idleStrikes).toBe(0);
  });

  it('hands the player to a bot after the strike limit', () => {
    let state = newGame();
    for (let i = 0; i < MODES.classic.idleStrikesLimit; i++) {
      state = applyAction({ ...state, currentPlayer: 0, phase: 'roll', debt: null }, { type: 'TIMEOUT' });
    }
    expect(state.players[0].isBot).toBe(true);
    expect(state.log.some((e) => e.text.includes('перехватывает бот'))).toBe(true);
  });

  it('in the debt phase fines the debtor and liquidates for them', () => {
    let state = newGame();
    state.owners[5] = 'p0';
    state.players[0].money = 150;
    resolveRoll(state, [1, 3]); // налог 200 → долг
    expect(state.phase).toBe('debt');
    state = applyAction(state, { type: 'TIMEOUT' });
    expect(state.pot).toBe(MODES.classic.idleFine);
    expect(state.players[0].idleStrikes).toBe(1);
    expect(state.mortgaged[5]).toBe(true);
  });

  it('is ignored after the game is over', () => {
    const state = { ...newGame(), phase: 'gameOver' as const };
    expect(applyAction(state, { type: 'TIMEOUT' })).toBe(state);
  });
});

describe('ежедневный бонус (D3)', () => {
  it('grows with a streak and resets after a missed day', () => {
    let record = claimBonus(null, '2026-09-01');
    expect(record).toEqual({ lastDay: '2026-09-01', streak: 1, unspent: DAILY_BONUS_STEPS[0] });
    record = claimBonus(spendBonus(record), '2026-09-02');
    expect(record.streak).toBe(2);
    expect(record.unspent).toBe(DAILY_BONUS_STEPS[1]);
    record = claimBonus(record, '2026-09-04');
    expect(record.streak).toBe(1);
    expect(record.unspent).toBe(DAILY_BONUS_STEPS[1] + DAILY_BONUS_STEPS[0]);
  });

  it('can be claimed once a day, also across month borders', () => {
    const record = claimBonus(null, '2026-09-30');
    expect(availableBonus(record, '2026-09-30')).toBeNull();
    expect(claimBonus(record, '2026-09-30')).toBe(record);
    expect(availableBonus(record, '2026-10-01')).toEqual({ streak: 2, amount: DAILY_BONUS_STEPS[1] });
  });

  it('caps at the last step', () => {
    const last = DAILY_BONUS_STEPS.at(-1)!;
    const record = { lastDay: '2026-09-01', streak: 40, unspent: 0 };
    expect(availableBonus(record, '2026-09-02')).toEqual({ streak: 41, amount: last });
  });

  it('adds to the human start money only', () => {
    const state = createGame({ playerName: 'Тест', bots: 2, seed: 1, startBonus: 150 });
    expect(state.players[0].money).toBe(START_MONEY + 150);
    expect(state.players[1].money).toBe(START_MONEY);
  });
});

describe('режимы и круги (D4)', () => {
  it('counts a round when the turn returns to the first living player', () => {
    let state = newGame(2);
    state = endTurn(state);
    state = endTurn(state);
    expect(state.round).toBe(1);
    state = endTurn(state);
    expect(state.round).toBe(2);
    expect(state.currentPlayer).toBe(0);

    state.players[0].bankrupt = true;
    state = endTurn(state);
    state = endTurn(state);
    expect(state.round).toBe(2);
    state = endTurn(state); // p0 выбыл: круг замыкается на p1
    expect(state.round).toBe(3);
    expect(state.round).toBe(3);
    expect(state.currentPlayer).toBe(1);
  });

  it('mode sets start money and salary', () => {
    const state = newGame(1, 'blitz');
    expect(state.mode).toBe('blitz');
    expect(state.players[0].money).toBe(MODES.blitz.startMoney);
    state.players[0].position = 38;
    resolveRoll(state, [1, 2]);
    expect(state.players[0].money).toBe(MODES.blitz.startMoney + MODES.blitz.salary);
    expect(MODES.classic.startMoney).toBe(START_MONEY);
    expect(MODES.classic.salary).toBe(START_SALARY);
  });

  it('net worth counts cash, cells, mortgages and buildings', () => {
    const state = newGame();
    state.owners[1] = 'p0';
    state.owners[3] = 'p0';
    state.owners[5] = 'p0';
    state.buildings[1] = TOWER_LEVEL;
    state.mortgaged[5] = true;
    // 1500 + 60 + 60 + (200 − 100) + 5 × 50
    expect(netWorth(state, state.players[0])).toBe(START_MONEY + 60 + 60 + 100 + 250);
    state.players[1].bankrupt = true;
    expect(netWorth(state, state.players[1])).toBe(0);
  });

  it('blitz ends after the round limit with the richest player winning', () => {
    let state = newGame(2, 'blitz');
    const limit = MODES.blitz.roundLimit!;
    state.round = limit;
    state.owners[39] = 'p1';
    state.currentPlayer = 2;
    state = endTurn(state);
    expect(state.phase).toBe('gameOver');
    expect(state.winnerId).toBe('p1');
    expect(state.round).toBe(limit);
    expect(state.log.at(-1)!.text).toContain('по капиталу');
  });

  it('blitz tie-break: more cash, then turn order; bankrupts are out', () => {
    const state = newGame(2, 'blitz');
    state.owners[1] = 'p0'; // p0: 1440 + 60 = 1500 капитала
    state.players[0].money -= 60;
    expect(standings(state).map((s) => s.player.id)).toEqual(['p1', 'p2', 'p0']);
    state.players[1].bankrupt = true;
    expect(standings(state).map((s) => s.player.id)).toEqual(['p2', 'p0']);
  });

  it('blitz does not stop before the limit and classic never stops by rounds', () => {
    let state = newGame(1, 'blitz');
    state.round = MODES.blitz.roundLimit! - 1;
    state.currentPlayer = 1;
    state = endTurn(state);
    expect(state.phase).toBe('roll');
    expect(state.round).toBe(MODES.blitz.roundLimit);

    state = newGame();
    state.round = 10_000;
    state.currentPlayer = 1;
    state = endTurn(state);
    expect(state.phase).toBe('roll');
  });

  it('blitz bot game always finishes within the limit', () => {
    const state = playOut(newGame(3, 'blitz'));
    expect(state.phase).toBe('gameOver');
    expect(state.winnerId).not.toBeNull();
    expect(state.round).toBeLessThanOrEqual(MODES.blitz.roundLimit!);
  });

  it('inflation doubles all rent every N rounds', () => {
    const { everyRounds, factor } = MODES.inflation.rentGrowth!;
    const state = newGame(1, 'inflation');
    state.owners[1] = 'p1';
    state.owners[5] = 'p1';
    const rent = (index: number) => calculateRent(state, BOARD[index] as OwnableCell, 7);
    state.round = everyRounds - 1;
    expect(rentMultiplier(state)).toBe(1);
    expect(rent(1)).toBe(2);
    state.round = everyRounds;
    expect(rent(1)).toBe(2 * factor);
    expect(rent(5)).toBe(25 * factor);
    state.round = everyRounds * 2;
    expect(rent(1)).toBe(2 * factor ** 2);

    const classic = newGame();
    classic.round = everyRounds * 3;
    expect(rentMultiplier(classic)).toBe(1);
  });

  it('inflation announces the growth when the threshold round starts', () => {
    const { everyRounds, factor } = MODES.inflation.rentGrowth!;
    let state = newGame(1, 'inflation');
    state.round = everyRounds - 1;
    state.currentPlayer = 1;
    state = endTurn(state);
    expect(state.round).toBe(everyRounds);
    expect(state.log.some((e) => e.text.includes(`×${factor}`))).toBe(true);
  });

  it('inflation rent can bankrupt a player and end the game', () => {
    const { everyRounds } = MODES.inflation.rentGrowth!;
    const state = newGame(1, 'inflation');
    state.round = everyRounds * 4; // ×16
    state.owners[37] = 'p1';
    state.owners[39] = 'p1';
    state.buildings[39] = TOWER_LEVEL;
    state.players[0].position = 36;
    resolveRoll(state, [1, 2]); // 39: 2000 × 16
    expect(state.players[0].bankrupt).toBe(true);
    expect(state.phase).toBe('gameOver');
    expect(state.winnerId).toBe('p1');
  });

  it('same seed and mode give the same game', () => {
    const a = playOut(newGame(2, 'inflation'), 3000);
    const b = playOut(newGame(2, 'inflation'), 3000);
    expect(a).toEqual(b);
  });
});
