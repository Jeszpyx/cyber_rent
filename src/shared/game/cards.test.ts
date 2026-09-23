import { describe, expect, it } from 'vitest';
import { ISOLATION_INDEX, START_MONEY, START_SALARY } from './board';
import { CARDS, CARD_BY_ID, deckCardIds } from './cards';
import { applyAction, createGame, resolveRoll } from './engine';
import type { CardDeck, GameState } from './types';

function newGame(bots = 1): GameState {
  return createGame({ playerName: 'Тест', bots, seed: 42 });
}

/** Puts the card on top of its deck. */
function putOnTop(state: GameState, id: string): void {
  const deck = state.decks[CARD_BY_ID[id].deck];
  deck.splice(deck.indexOf(id), 1);
  deck.unshift(id);
}

/** Places the current player on `position` with the card already drawn. */
function withPendingCard(state: GameState, id: string, position: number): GameState {
  state.players[state.currentPlayer].position = position;
  state.pendingCard = id;
  state.phase = 'card';
  state.dice = [1, 2];
  return state;
}

describe('card data', () => {
  it('has 16 cards with unique ids in each deck', () => {
    for (const deck of ['hack', 'net'] as CardDeck[]) {
      expect(deckCardIds(deck)).toHaveLength(16);
    }
    expect(new Set(CARDS.map((c) => c.id)).size).toBe(CARDS.length);
  });

  it('moveTo targets are valid board cells', () => {
    for (const card of CARDS) {
      if (card.effect.type === 'moveTo') {
        expect(card.effect.index).toBeGreaterThanOrEqual(0);
        expect(card.effect.index).toBeLessThan(40);
      }
    }
  });
});

describe('decks', () => {
  it('shuffles decks deterministically by seed', () => {
    const a = newGame();
    const b = newGame();
    expect(a.decks).toEqual(b.decks);
    expect([...a.decks.hack].sort()).toEqual(deckCardIds('hack'));
    expect([...a.decks.net].sort()).toEqual(deckCardIds('net'));
    expect(createGame({ playerName: 'Тест', bots: 1, seed: 43 }).decks).not.toEqual(a.decks);
  });

  it('draws from the top and puts the card to the bottom', () => {
    const state = newGame();
    putOnTop(state, 'hack-11');
    state.players[0].position = 4;
    resolveRoll(state, [1, 2]); // cell 7 — «Взлом»
    expect(state.phase).toBe('card');
    expect(state.pendingCard).toBe('hack-11');
    expect(state.decks.hack.at(-1)).toBe('hack-11');
    expect(state.decks.hack).toHaveLength(16);
  });

  it('ignores APPLY_CARD outside the card phase', () => {
    const state = newGame();
    expect(applyAction(state, { type: 'APPLY_CARD' })).toBe(state);
  });
});

describe('card effects', () => {
  it('money: receives from the bank', () => {
    const after = applyAction(withPendingCard(newGame(), 'hack-12', 7), { type: 'APPLY_CARD' });
    expect(after.players[0].money).toBe(START_MONEY + 150);
    expect(after.pendingCard).toBeNull();
    expect(after.phase).toBe('end');
  });

  it('money: pays the bank', () => {
    const after = applyAction(withPendingCard(newGame(), 'net-12', 2), { type: 'APPLY_CARD' });
    expect(after.players[0].money).toBe(START_MONEY - 100);
  });

  it('moveTo: passing Start pays salary and resolves the landing cell', () => {
    const after = applyAction(withPendingCard(newGame(), 'hack-03', 22), { type: 'APPLY_CARD' });
    expect(after.players[0].position).toBe(11);
    expect(after.players[0].money).toBe(START_MONEY + START_SALARY);
    expect(after.phase).toBe('buyDecision');
  });

  it('moveTo: no salary without passing Start', () => {
    const after = applyAction(withPendingCard(newGame(), 'hack-02', 7), { type: 'APPLY_CARD' });
    expect(after.players[0].position).toBe(24);
    expect(after.players[0].money).toBe(START_MONEY);
  });

  it('moveTo Start pays salary', () => {
    const after = applyAction(withPendingCard(newGame(), 'net-01', 33), { type: 'APPLY_CARD' });
    expect(after.players[0].position).toBe(0);
    expect(after.players[0].money).toBe(START_MONEY + START_SALARY);
    expect(after.phase).toBe('end');
  });

  it('moveTo: pays rent on an owned cell', () => {
    const state = withPendingCard(newGame(), 'hack-02', 7);
    state.owners[24] = 'p1';
    const after = applyAction(state, { type: 'APPLY_CARD' });
    expect(after.players[0].money).toBe(START_MONEY - 20);
    expect(after.players[1].money).toBe(START_MONEY + 20);
  });

  it('moveBy backwards wraps around Start without salary', () => {
    const after = applyAction(withPendingCard(newGame(), 'hack-07', 2), { type: 'APPLY_CARD' });
    expect(after.players[0].position).toBe(39);
    expect(after.players[0].money).toBe(START_MONEY);
    expect(after.phase).toBe('buyDecision');
  });

  it('moveBy onto a card cell draws another card', () => {
    const state = withPendingCard(newGame(), 'hack-07', 36);
    putOnTop(state, 'net-02');
    const after = applyAction(state, { type: 'APPLY_CARD' });
    expect(after.players[0].position).toBe(33);
    expect(after.phase).toBe('card');
    expect(after.pendingCard).toBe('net-02');
  });

  it('goToIsolation moves to Isolation without salary and cancels the double', () => {
    const state = withPendingCard(newGame(), 'hack-09', 36);
    state.rolledDouble = true;
    const after = applyAction(state, { type: 'APPLY_CARD' });
    expect(after.players[0].position).toBe(ISOLATION_INDEX);
    expect(after.players[0].money).toBe(START_MONEY);
    expect(after.phase).toBe('end');
  });

  it('payEachPlayer pays every active opponent', () => {
    const state = withPendingCard(newGame(3), 'hack-15', 7);
    state.players[2].bankrupt = true;
    const after = applyAction(state, { type: 'APPLY_CARD' });
    expect(after.players[0].money).toBe(START_MONEY - 100);
    expect(after.players[1].money).toBe(START_MONEY + 50);
    expect(after.players[2].money).toBe(START_MONEY);
    expect(after.players[3].money).toBe(START_MONEY + 50);
  });

  it('payEachPlayer can bankrupt the payer', () => {
    const state = withPendingCard(newGame(2), 'hack-15', 7);
    state.players[0].money = 70;
    const after = applyAction(state, { type: 'APPLY_CARD' });
    expect(after.players[0].bankrupt).toBe(true);
    expect(after.players[1].money).toBe(START_MONEY + 50);
    expect(after.players[2].money).toBe(START_MONEY + 20);
  });

  it('collectFromEachPlayer takes money from every opponent', () => {
    const after = applyAction(withPendingCard(newGame(3), 'net-07', 2), { type: 'APPLY_CARD' });
    expect(after.players[0].money).toBe(START_MONEY + 150);
    for (const bot of after.players.slice(1)) expect(bot.money).toBe(START_MONEY - 50);
  });

  it('collectFromEachPlayer can bankrupt an opponent and end the game', () => {
    const state = withPendingCard(newGame(1), 'net-07', 2);
    state.players[1].money = 30;
    const after = applyAction(state, { type: 'APPLY_CARD' });
    expect(after.players[0].money).toBe(START_MONEY + 30);
    expect(after.players[1].bankrupt).toBe(true);
    expect(after.phase).toBe('gameOver');
    expect(after.winnerId).toBe('p0');
  });

  it('getOutOfIsolation stays with the player until bankruptcy and goes to the creditor', () => {
    const state = newGame();
    putOnTop(state, 'hack-10');
    state.players[0].position = 4;
    resolveRoll(state, [1, 2]);
    expect(state.decks.hack).not.toContain('hack-10');

    const after = applyAction(state, { type: 'APPLY_CARD' });
    expect(after.players[0].releaseCards).toEqual(['hack-10']);

    after.players[0].money = 0;
    after.phase = 'end';
    after.currentPlayer = 1;
    const bankrupting = withPendingCard(after, 'net-07', 2);
    const final = applyAction(bankrupting, { type: 'APPLY_CARD' });
    expect(final.players[0].bankrupt).toBe(true);
    expect(final.players[0].releaseCards).toEqual([]);
    expect(final.players[1].releaseCards).toEqual(['hack-10']);
    expect(final.decks.hack).not.toContain('hack-10');
  });

  it('repairs charge per module and per tower on owned cells', () => {
    const state = withPendingCard(newGame(), 'hack-16', 7);
    state.owners[1] = 'p0';
    state.owners[3] = 'p0';
    state.owners[6] = 'p1';
    state.buildings = { 1: 3, 3: 5, 6: 4 };
    const after = applyAction(state, { type: 'APPLY_CARD' });
    expect(after.players[0].money).toBe(START_MONEY - (3 * 25 + 100));
  });

  it('repairs cost nothing without buildings', () => {
    const after = applyAction(withPendingCard(newGame(), 'net-16', 2), { type: 'APPLY_CARD' });
    expect(after.players[0].money).toBe(START_MONEY);
  });
});
