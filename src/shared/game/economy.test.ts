import { describe, expect, it } from 'vitest';
import { BAIL, BANK_MODULES, BANK_TOWERS, BOARD, ISOLATION_INDEX, START_MONEY, TOWER_LEVEL } from './board';
import { decideBotAction } from './bot';
import { actingPlayer, bankStock, canBuild, liquidationValue, unmortgageCost } from './economy';
import { applyAction, calculateRent, createGame, resolveRoll } from './engine';
import type { Action, GameState, OwnableCell } from './types';

function newGame(bots = 1): GameState {
  return createGame({ playerName: 'Тест', bots, seed: 42 });
}

/** p0 владеет кварталом «rust» (клетки 1 и 3, модуль 50₵). */
function withRust(state = newGame(), owner = 'p0'): GameState {
  state.owners[1] = owner;
  state.owners[3] = owner;
  return state;
}

/** Fills the whole board with buildings of p1 until the bank has `modules` modules and `towers` towers left. */
function drainBank(state: GameState, modules: number, towers: number): void {
  const cells = BOARD.filter((c) => c.kind === 'district' && c.index > 3).map((c) => c.index);
  let needTowers = BANK_TOWERS - towers;
  let needModules = BANK_MODULES - modules;
  for (const index of cells) {
    state.owners[index] = 'p1';
    if (needTowers > 0) {
      state.buildings[index] = TOWER_LEVEL;
      needTowers--;
    } else if (needModules > 0) {
      const level = Math.min(4, needModules);
      state.buildings[index] = level;
      needModules -= level;
    }
  }
}

const rent = (state: GameState, index: number) => calculateRent(state, BOARD[index] as OwnableCell, 7);
const act = (state: GameState, ...actions: Action[]) => actions.reduce(applyAction, state);

describe('rent table (C1)', () => {
  it('every district has six rent levels that grow', () => {
    for (const cell of BOARD) {
      if (cell.kind !== 'district') continue;
      expect(cell.rent).toHaveLength(6);
      for (let i = 1; i < 6; i++) expect(cell.rent[i]).toBeGreaterThan(cell.rent[i - 1]);
    }
  });

  it('uses the table by building level', () => {
    const state = withRust();
    expect(rent(state, 3)).toBe(8); // монополия без построек — ×2
    state.buildings = { 1: 1, 3: 2 };
    expect(rent(state, 1)).toBe(10);
    expect(rent(state, 3)).toBe(60);
    state.buildings = { 1: 5, 3: 5 };
    expect(rent(state, 3)).toBe(450);
  });

  it('charges the table rent on landing', () => {
    const state = withRust(newGame(), 'p1');
    state.buildings = { 1: 4, 3: 4 };
    resolveRoll(state, [1, 2]);
    expect(state.players[0].money).toBe(START_MONEY - 320);
    expect(state.players[1].money).toBe(START_MONEY + 320);
  });
});

describe('BUILD / SELL_BUILDING (C2)', () => {
  it('builds a module on a monopoly and charges the cost', () => {
    const after = applyAction(withRust(), { type: 'BUILD', index: 1 });
    expect(after.buildings[1]).toBe(1);
    expect(after.players[0].money).toBe(START_MONEY - 50);
  });

  it('refuses without a monopoly, on a mortgaged group, without money or in a wrong phase', () => {
    const noMono = newGame();
    noMono.owners[1] = 'p0';
    expect(applyAction(noMono, { type: 'BUILD', index: 1 })).toBe(noMono);

    const mortgaged = withRust();
    mortgaged.mortgaged[3] = true;
    expect(applyAction(mortgaged, { type: 'BUILD', index: 1 })).toBe(mortgaged);

    const poor = withRust();
    poor.players[0].money = 49;
    expect(applyAction(poor, { type: 'BUILD', index: 1 })).toBe(poor);

    const buying = withRust();
    buying.phase = 'buyDecision';
    expect(applyAction(buying, { type: 'BUILD', index: 1 })).toBe(buying);

    const foreign = withRust(newGame(), 'p1');
    expect(applyAction(foreign, { type: 'BUILD', index: 1 })).toBe(foreign);
  });

  it('works with exactly the cost in cash and in the isolation and end phases', () => {
    const state = withRust();
    state.players[0].money = 50;
    state.phase = 'end';
    expect(applyAction(state, { type: 'BUILD', index: 1 }).players[0].money).toBe(0);
    state.phase = 'isolation';
    expect(applyAction(state, { type: 'BUILD', index: 1 }).buildings[1]).toBe(1);
  });

  it('requires even building across the group', () => {
    const state = act(withRust(), { type: 'BUILD', index: 1 });
    expect(applyAction(state, { type: 'BUILD', index: 1 })).toBe(state);
    const even = act(state, { type: 'BUILD', index: 3 }, { type: 'BUILD', index: 1 });
    expect(even.buildings).toEqual({ 1: 2, 3: 1 });
  });

  it('builds up to a tower and no further', () => {
    const state = withRust();
    state.buildings = { 1: 4, 3: 4 };
    const tower = applyAction(state, { type: 'BUILD', index: 1 });
    expect(tower.buildings[1]).toBe(TOWER_LEVEL);
    const both = applyAction(tower, { type: 'BUILD', index: 3 });
    expect(applyAction(both, { type: 'BUILD', index: 3 })).toBe(both);
  });

  it('sells evenly from the highest cell at half price', () => {
    const state = withRust();
    state.buildings = { 1: 2, 3: 1 };
    expect(applyAction(state, { type: 'SELL_BUILDING', index: 3 })).toBe(state);
    const after = applyAction(state, { type: 'SELL_BUILDING', index: 1 });
    expect(after.buildings).toEqual({ 1: 1, 3: 1 });
    expect(after.players[0].money).toBe(START_MONEY + 25);
    const empty = act(after, { type: 'SELL_BUILDING', index: 1 }, { type: 'SELL_BUILDING', index: 3 });
    expect(empty.buildings).toEqual({});
    expect(applyAction(empty, { type: 'SELL_BUILDING', index: 1 })).toBe(empty);
  });
});

describe('bank stock (C3)', () => {
  it('counts modules and towers on the board', () => {
    const state = newGame();
    expect(bankStock(state)).toEqual({ modules: BANK_MODULES, towers: BANK_TOWERS });
    state.buildings = { 1: 3, 3: 5 };
    expect(bankStock(state)).toEqual({ modules: BANK_MODULES - 3, towers: BANK_TOWERS - 1 });
  });

  it('refuses a module when the bank is out of modules', () => {
    const state = withRust();
    drainBank(state, 0, BANK_TOWERS);
    expect(canBuild(state, 1)).toBe(false);
    const last = withRust();
    drainBank(last, 1, BANK_TOWERS);
    const after = applyAction(last, { type: 'BUILD', index: 1 });
    expect(after.buildings[1]).toBe(1);
    expect(canBuild(after, 3)).toBe(false);
  });

  it('refuses a tower when the bank is out of towers; a tower returns 4 modules', () => {
    const state = withRust();
    state.buildings[1] = 4;
    state.buildings[3] = 4;
    drainBank(state, 0, 0);
    expect(canBuild(state, 1)).toBe(false);

    const ok = withRust();
    ok.buildings = { 1: 4, 3: 4 };
    const after = applyAction(ok, { type: 'BUILD', index: 1 });
    expect(bankStock(after)).toEqual({ modules: BANK_MODULES - 4, towers: BANK_TOWERS - 1 });
  });

  it('selling a tower without spare modules leaves only what the bank has', () => {
    const state = withRust();
    state.buildings = { 1: 5, 3: 5 };
    drainBank(state, 2, 5);
    const after = applyAction(state, { type: 'SELL_BUILDING', index: 1 });
    expect(after.buildings[1]).toBe(2);
    expect(after.players[0].money).toBe(START_MONEY + 3 * 25);
    expect(bankStock(after).modules).toBe(0);
  });
});

describe('MORTGAGE / UNMORTGAGE (C4)', () => {
  it('mortgage pays half the price and stops the rent, but keeps the monopoly', () => {
    const state = withRust(newGame(), 'p1');
    state.currentPlayer = 1;
    const after = applyAction(state, { type: 'MORTGAGE', index: 1 });
    expect(after.mortgaged[1]).toBe(true);
    expect(after.players[1].money).toBe(START_MONEY + 30);
    expect(rent(after, 1)).toBe(0);
    expect(rent(after, 3)).toBe(8);
    expect(applyAction(after, { type: 'MORTGAGE', index: 1 })).toBe(after);
  });

  it('landing on a mortgaged cell costs nothing', () => {
    const state = withRust(newGame(), 'p1');
    state.mortgaged[3] = true;
    resolveRoll(state, [1, 2]);
    expect(state.players[0].money).toBe(START_MONEY);
    expect(state.phase).toBe('end');
  });

  it('refuses while the group has buildings; transit and utilities can be mortgaged', () => {
    const state = withRust();
    state.buildings = { 3: 1 };
    expect(applyAction(state, { type: 'MORTGAGE', index: 1 })).toBe(state);
    state.owners[5] = 'p0';
    state.owners[12] = 'p0';
    const after = act(state, { type: 'MORTGAGE', index: 5 }, { type: 'MORTGAGE', index: 12 });
    expect(after.players[0].money).toBe(START_MONEY + 100 + 75);
  });

  it('unmortgage costs +10% and needs the money', () => {
    const state = withRust();
    state.mortgaged[1] = true;
    expect(unmortgageCost(BOARD[1] as OwnableCell)).toBe(33);
    const after = applyAction(state, { type: 'UNMORTGAGE', index: 1 });
    expect(after.mortgaged[1]).toBeUndefined();
    expect(after.players[0].money).toBe(START_MONEY - 33);
    state.players[0].money = 32;
    expect(applyAction(state, { type: 'UNMORTGAGE', index: 1 })).toBe(state);
    expect(unmortgageCost(BOARD[37] as OwnableCell)).toBe(193);
  });
});

describe('debt phase', () => {
  /** p0 стоит перед рентой 320₵ на клетке 3 игрока p1 и владеет «Монорельс Юг» (залог 100₵). */
  function rentDebt(money: number): GameState {
    const state = withRust(newGame(), 'p1');
    state.buildings = { 1: 4, 3: 4 };
    state.owners[5] = 'p0';
    state.players[0].money = money;
    resolveRoll(state, [1, 2]);
    return state;
  }

  it('enters the debt phase when assets can cover the payment', () => {
    const state = rentDebt(250);
    expect(state.phase).toBe('debt');
    expect(state.debt).toMatchObject({ from: 'p0', to: 'p1', amount: 320 });
    expect(state.players[0].money).toBe(250);
    expect(applyAction(state, { type: 'PAY_DEBT' })).toBe(state);
    expect(applyAction(state, { type: 'END_TURN' })).toBe(state);
    expect(applyAction(state, { type: 'BUILD', index: 1 })).toBe(state);
  });

  it('mortgage, then pay the debt and finish the move', () => {
    const state = act(rentDebt(250), { type: 'MORTGAGE', index: 5 }, { type: 'PAY_DEBT' });
    expect(state.debt).toBeNull();
    expect(state.players[0].money).toBe(250 + 100 - 320);
    expect(state.players[1].money).toBe(START_MONEY + 320);
    expect(state.phase).toBe('end');
  });

  it('bankrupts at once when even full liquidation is not enough', () => {
    const state = rentDebt(200);
    expect(state.phase).toBe('gameOver');
    expect(state.players[0].bankrupt).toBe(true);
    expect(state.owners[5]).toBe('p1');
    expect(state.players[1].money).toBe(START_MONEY + 200);
  });

  it('DECLARE_BANKRUPTCY gives the creditor cash, buildings value and cells', () => {
    const after = applyAction(rentDebt(250), { type: 'DECLARE_BANKRUPTCY' });
    expect(after.players[0].bankrupt).toBe(true);
    expect(after.owners[5]).toBe('p1');
    expect(after.players[1].money).toBe(START_MONEY + 250);
    expect(after.phase).toBe('gameOver');
    expect(after.winnerId).toBe('p1');
  });

  it('creditor gets buildings as money at half price and mortgaged cells as they are', () => {
    const state = withRust(newGame(2));
    state.buildings = { 1: 2, 3: 2 };
    state.owners[5] = 'p0';
    state.mortgaged[5] = true;
    state.owners[39] = 'p1';
    state.players[0].position = 36;
    state.players[0].money = 10;
    resolveRoll(state, [1, 2]); // 39 — рента 50₵, наличных 10
    expect(state.phase).toBe('debt');
    const after = applyAction(state, { type: 'DECLARE_BANKRUPTCY' });
    expect(after.players[1].money).toBe(START_MONEY + 10 + 4 * 25);
    expect(after.buildings).toEqual({});
    expect(after.owners[1]).toBe('p1');
    expect(after.owners[5]).toBe('p1');
    expect(after.mortgaged[5]).toBe(true);
    expect(after.debt).toBeNull();
    expect(after.phase).toBe('end');
    expect(after.currentPlayer).toBe(0);
    expect(applyAction(after, { type: 'END_TURN' }).currentPlayer).toBe(1);
  });

  it('bank bankruptcy frees cells and removes mortgages and buildings', () => {
    const state = withRust();
    state.mortgaged[1] = true;
    state.buildings = {};
    state.players[0].position = 1;
    state.players[0].money = 10;
    resolveRoll(state, [1, 2]); // 4 — налог 200₵, активов 10 + 30 = 40
    expect(state.players[0].bankrupt).toBe(true);
    expect(state.owners[1]).toBeUndefined();
    expect(state.owners[3]).toBeUndefined();
    expect(state.mortgaged).toEqual({});
    expect(state.phase).toBe('gameOver');
  });

  it('a non-current debtor decides: collectFromEachPlayer', () => {
    const state = newGame(2);
    state.players[1].money = 10;
    state.owners[5] = 'p1';
    state.players[0].position = 2;
    state.pendingCard = 'net-07';
    state.phase = 'card';
    const debt = applyAction(state, { type: 'APPLY_CARD' });
    expect(debt.phase).toBe('debt');
    expect(actingPlayer(debt).id).toBe('p1');
    expect(debt.debt?.queue).toEqual([{ from: 'p2', to: 'p0', amount: 50 }]);
    const after = act(debt, { type: 'MORTGAGE', index: 5 }, { type: 'PAY_DEBT' });
    expect(after.players[1].money).toBe(10 + 100 - 50);
    expect(after.players[2].money).toBe(START_MONEY - 50);
    expect(after.players[0].money).toBe(START_MONEY + 100);
    expect(after.phase).toBe('end');
    expect(after.currentPlayer).toBe(0);
  });

  it('forced bail in debt continues with the move after paying', () => {
    const state = newGame();
    state.players[0].position = ISOLATION_INDEX;
    state.players[0].isolation = { turnsLeft: 1 };
    state.players[0].money = 10;
    state.owners[5] = 'p0';
    state.phase = 'isolation';
    resolveRoll(state, [1, 2]);
    expect(state.phase).toBe('debt');
    const after = act(state, { type: 'MORTGAGE', index: 5 }, { type: 'PAY_DEBT' });
    expect(after.players[0].money).toBe(10 + 100 - BAIL);
    expect(after.players[0].isolation).toBeNull();
    expect(after.players[0].position).toBe(13);
    expect(after.phase).toBe('end'); // на покупку 140₵ уже не хватает
  });

  it('payEachPlayer continues the queue after the debt is paid', () => {
    const state = newGame(2);
    state.players[0].money = 60;
    state.owners[5] = 'p0';
    state.players[0].position = 7;
    state.pendingCard = 'hack-15';
    state.phase = 'card';
    const debt = applyAction(state, { type: 'APPLY_CARD' });
    expect(debt.phase).toBe('debt');
    expect(debt.debt).toMatchObject({ from: 'p0', to: 'p2', amount: 50 });
    const after = act(debt, { type: 'MORTGAGE', index: 5 }, { type: 'PAY_DEBT' });
    expect(after.players.map((p) => p.money)).toEqual([60, START_MONEY + 50, START_MONEY + 50]);
    expect(after.phase).toBe('end');
  });

  it('liquidation value counts cash, buildings and unmortgaged cells', () => {
    const state = withRust();
    state.buildings = { 1: 1, 3: 2 };
    state.mortgaged[3] = true;
    expect(liquidationValue(state, state.players[0])).toBe(START_MONEY + 3 * 25 + 30);
  });
});

describe('bot economy (C6)', () => {
  it('builds with a monopoly while keeping the reserve', () => {
    const state = withRust();
    state.phase = 'end';
    expect(decideBotAction(state)).toEqual({ type: 'BUILD', index: 1 });
    state.players[0].money = 349;
    expect(decideBotAction(state)).toEqual({ type: 'END_TURN' });
  });

  it('redeems mortgaged cells first', () => {
    const state = withRust();
    state.mortgaged[3] = true;
    state.phase = 'end';
    expect(decideBotAction(state)).toEqual({ type: 'UNMORTGAGE', index: 3 });
  });

  it('in debt mortgages loose cells, then sells buildings, then pays', () => {
    const state = newGame();
    withRust(state, 'p0');
    state.buildings = { 1: 1, 3: 1 };
    state.owners[5] = 'p0';
    state.players[0].money = 0;
    state.phase = 'debt';
    state.debt = { from: 'p0', to: null, amount: 140, queue: [], then: 'finish' };
    const steps: Action[] = [];
    let current = state;
    for (let i = 0; i < 10 && current.phase === 'debt'; i++) {
      const action = decideBotAction(current)!;
      steps.push(action);
      current = applyAction(current, action);
    }
    expect(steps).toEqual([
      { type: 'MORTGAGE', index: 5 },
      { type: 'SELL_BUILDING', index: 1 },
      { type: 'SELL_BUILDING', index: 3 },
      { type: 'PAY_DEBT' },
    ]);
    expect(current.players[0].money).toBe(10);
    expect(current.phase).toBe('end');
  });

  it('bots build, pass debts without getting stuck and finish games', () => {
    // Без обмена (блок E) монополии у ботов складываются не всегда; в этих партиях — складываются.
    const seen = new Set<string>();
    let finished = 0;
    for (const seed of [1, 7, 10]) {
      let state = createGame({ playerName: 'Тест', bots: 3, seed });
      for (let i = 0; i < 3000 && state.phase !== 'gameOver'; i++) {
        const action = decideBotAction(state)!;
        const next = applyAction(state, action);
        expect(next).not.toBe(state);
        seen.add(action.type);
        state = next;
      }
      if (state.phase === 'gameOver') finished++;
    }
    for (const type of ['BUILD', 'MORTGAGE', 'UNMORTGAGE', 'SELL_BUILDING', 'PAY_DEBT']) expect(seen).toContain(type);
    expect(finished).toBe(3);
  });
});
