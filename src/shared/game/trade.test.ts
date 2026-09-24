import { describe, expect, it } from 'vitest';
import { AUCTION_STEP, BOARD, START_MONEY } from './board';
import { decideBotAction, tradeGain } from './bot';
import { EMPTY_OFFER, actingPlayer, canBuild, mortgageValue } from './economy';
import { applyAction, createGame, resolveRoll } from './engine';
import type { Action, GameState, OwnableCell, Trade, TradeOffer } from './types';

function newGame(bots = 2): GameState {
  return createGame({ playerName: 'Тест', bots, seed: 42 });
}

const act = (state: GameState, ...actions: Action[]) => actions.reduce(applyAction, state);
const offer = (part: Partial<TradeOffer>): TradeOffer => ({ ...EMPTY_OFFER, ...part });
const bid = (amount: number): Action => ({ type: 'BID', amount });
const PASS: Action = { type: 'PASS' };

/** p0 стоит на «Свалке Кабелей» (3, цена 60) и решает, покупать ли. */
function atCable(bots = 2): GameState {
  const state = newGame(bots);
  resolveRoll(state, [1, 2]);
  return state;
}

function auctionOn(bots = 2): GameState {
  return applyAction(atCable(bots), { type: 'START_AUCTION' });
}

function trade(from: string, to: string, give: Partial<TradeOffer>, take: Partial<TradeOffer>): Trade {
  return { from, to, give: offer(give), take: offer(take) };
}

const propose = (state: GameState, t: Trade) => applyAction(state, { type: 'PROPOSE_TRADE', trade: t });

/** Прогоняет партию одними ботами (человек тоже ходит через decideBotAction). */
function playOut(state: GameState, seen: Set<string>, maxActions = 20_000): GameState {
  for (let i = 0; i < maxActions && state.phase !== 'gameOver'; i++) {
    const action = decideBotAction(state)!;
    const next = applyAction(state, action);
    expect(next).not.toBe(state);
    seen.add(action.type);
    state = next;
  }
  return state;
}

describe('торги (E1)', () => {
  it('refusing to buy starts an auction: next player first, the refuser last', () => {
    const state = auctionOn();
    expect(state.phase).toBe('auction');
    expect(state.auction).toEqual({ index: 3, bid: 0, leaderId: null, queue: ['p1', 'p2', 'p0'] });
    expect(actingPlayer(state).id).toBe('p1');
  });

  it('a bid moves the bidder to the end of the queue; the last one standing buys at their bid', () => {
    let state = act(auctionOn(), bid(20), bid(40));
    expect(state.auction).toMatchObject({ bid: 40, leaderId: 'p2', queue: ['p0', 'p1', 'p2'] });
    state = act(state, bid(50), PASS, PASS);
    expect(state.auction).toBeNull();
    expect(state.owners[3]).toBe('p0');
    expect(state.players[0].money).toBe(START_MONEY - 50);
    expect(state.pot).toBe(0); // покупка на торгах оплачивается банку, а не в копилку
    expect(state.phase).toBe('end');
  });

  it('the refuser can win the auction below the price', () => {
    const state = act(auctionOn(), PASS, PASS, bid(AUCTION_STEP));
    expect(state.owners[3]).toBe('p0');
    expect(state.players[0].money).toBe(START_MONEY - AUCTION_STEP);
  });

  it('if everybody passes, the cell stays with the bank', () => {
    const state = act(auctionOn(), PASS, PASS, PASS);
    expect(state.owners[3]).toBeUndefined();
    expect(state.players.map((p) => p.money)).toEqual([START_MONEY, START_MONEY, START_MONEY]);
    expect(state.phase).toBe('end');
    expect(state.log.at(-1)!.text).toContain('остаётся у банка');
  });

  it('rejects bids below the step, above cash, fractional, and outside of an auction', () => {
    const state = act(auctionOn(), bid(100));
    for (const amount of [100, 105.5, START_MONEY + 1]) expect(applyAction(state, bid(amount))).toBe(state);
    const fresh = auctionOn();
    expect(applyAction(fresh, bid(AUCTION_STEP - 1))).toBe(fresh);
    const buying = atCable();
    expect(applyAction(buying, bid(100))).toBe(buying);
    expect(applyAction(buying, PASS)).toBe(buying);
  });

  it('a bid of all the cash is allowed', () => {
    const start = auctionOn();
    start.players[1].money = 300;
    const state = act(start, bid(300), PASS, PASS);
    expect(state.owners[3]).toBe('p1');
    expect(state.players[1].money).toBe(0);
  });

  it('players without cash for the minimal bid drop out automatically', () => {
    const start = atCable();
    start.players[1].money = 5;
    let state = applyAction(start, { type: 'START_AUCTION' });
    expect(state.auction!.queue).toEqual(['p2', 'p0']);
    start.players[2].money = 100;
    state = act(applyAction(start, { type: 'START_AUCTION' }), bid(100));
    // p2 поставил всё; p0 пасует — p2 покупает
    expect(applyAction(state, PASS).owners[3]).toBe('p2');
  });

  it('nobody able to bid ends the auction at once', () => {
    const start = atCable();
    for (const p of start.players) p.money = AUCTION_STEP - 1;
    const state = applyAction(start, { type: 'START_AUCTION' });
    expect(state.phase).toBe('end');
    expect(state.owners[3]).toBeUndefined();
  });

  it('landing on a free cell without money for it starts the auction automatically', () => {
    const state = newGame();
    state.players[0].money = 50;
    resolveRoll(state, [1, 2]);
    expect(state.phase).toBe('auction');
    expect(state.auction!.queue).toEqual(['p1', 'p2', 'p0']);
  });

  it('bankrupt players do not take part', () => {
    const state = newGame();
    state.players[1].bankrupt = true;
    resolveRoll(state, [1, 2]);
    expect(applyAction(state, { type: 'START_AUCTION' }).auction!.queue).toEqual(['p2', 'p0']);
  });

  it('after a double the auction returns the turn to rolling', () => {
    const state = newGame();
    resolveRoll(state, [4, 4]); // 8, свободный район
    expect(act(state, { type: 'START_AUCTION' }, PASS, PASS, PASS).phase).toBe('roll');
  });

  it('no building or trading during an auction', () => {
    const state = auctionOn();
    state.owners[1] = 'p1';
    state.owners[3] = 'p1';
    expect(canBuild(state, 1)).toBe(false);
    expect(propose(state, trade('p1', 'p0', { money: 10 }, {}))).toBe(state);
  });

  it('timeout fines the bidder whose turn it is, then the bot decides for them', () => {
    const start = auctionOn(1); // очередь: p1, p0
    const state = act(start, bid(100)); // решает человек p0
    const after = applyAction(state, { type: 'TIMEOUT' });
    expect(after.players[0].money).toBe(START_MONEY - 50);
    expect(after.pot).toBe(50);
    // за человека сработал бот: 100₵ выше его предела — пас, торги выигрывает p1
    expect(after.owners[3]).toBe('p1');
    expect(after.phase).toBe('end');
  });
});

describe('боты на торгах (E2)', () => {
  it('opens with half of the price and raises by 10% of it', () => {
    const state = auctionOn();
    expect(decideBotAction(state)).toEqual(bid(30)); // Свалка 60₵
    expect(decideBotAction(act(state, bid(30)))).toEqual(bid(40)); // шаг не меньше AUCTION_STEP
  });

  it('bids up to price × k and passes above it', () => {
    const state = auctionOn();
    state.auction!.bid = 50;
    state.auction!.leaderId = 'p0';
    expect(decideBotAction(state)).toEqual(bid(60)); // предел 60 × 1
    state.auction!.bid = 60;
    expect(decideBotAction(state)).toEqual(PASS);
  });

  it('pays more for a cell of its own group and to block a monopoly', () => {
    const own = auctionOn();
    own.owners[1] = 'p1';
    own.auction!.bid = 80;
    expect(decideBotAction(own)).toEqual(bid(90)); // предел 60 × 1.5
    own.auction!.bid = 90;
    expect(decideBotAction(own)).toEqual(PASS);

    const block = auctionOn();
    block.owners[1] = 'p0';
    block.auction!.bid = 60;
    expect(decideBotAction(block)).toEqual(bid(70)); // предел 60 × 1.25 = 75
    block.auction!.bid = 70;
    expect(decideBotAction(block)).toEqual(PASS);
  });

  it('keeps a cash reserve', () => {
    const state = auctionOn();
    state.players[1].money = 220;
    expect(decideBotAction(state)).toEqual(bid(20));
    state.players[1].money = 205;
    expect(decideBotAction(state)).toEqual(PASS);
  });

  it('a bots-only auction always ends', () => {
    let state = atCable();
    state.players[0].isBot = true;
    state = applyAction(state, { type: 'START_AUCTION' });
    for (let i = 0; i < 100 && state.phase === 'auction'; i++) state = applyAction(state, decideBotAction(state)!);
    expect(state.phase).toBe('end');
    const winner = state.players.find((p) => p.id === state.owners[3])!;
    expect(START_MONEY - winner.money).toBeLessThanOrEqual(60);
  });
});

describe('обмен (E3)', () => {
  /** p0 (человек) и боты p1, p2; ход p0, фаза 'end'. */
  function inEnd(bots = 2): GameState {
    const state = newGame(bots);
    state.phase = 'end';
    return state;
  }

  it('a proposal waits for the answer of the addressee', () => {
    const state = inEnd();
    state.owners[5] = 'p1';
    const after = propose(state, trade('p0', 'p1', { money: 300 }, { cells: [5] }));
    expect(after.phase).toBe('trade');
    expect(after.trade).toMatchObject({ from: 'p0', to: 'p1', resume: 'end' });
    expect(actingPlayer(after).id).toBe('p1');
  });

  it('accepting hands over cells (with mortgage), money and release cards', () => {
    const state = inEnd();
    state.owners[1] = 'p0';
    state.owners[5] = 'p1';
    state.mortgaged[5] = true;
    state.players[1].releaseCards = ['net-05'];
    const t = trade('p0', 'p1', { cells: [1], money: 100 }, { cells: [5], releaseCards: ['net-05'] });
    const after = act(state, { type: 'PROPOSE_TRADE', trade: t }, { type: 'ACCEPT_TRADE' });
    expect(after.owners[1]).toBe('p1');
    expect(after.owners[5]).toBe('p0');
    expect(after.mortgaged[5]).toBe(true);
    expect(after.players[0].money).toBe(START_MONEY - 100);
    expect(after.players[1].money).toBe(START_MONEY + 100);
    expect(after.players[0].releaseCards).toEqual(['net-05']);
    expect(after.players[1].releaseCards).toEqual([]);
    expect(after.phase).toBe('end');
    expect(after.trade).toBeNull();
  });

  it('rejecting changes nothing and returns to the turn phase', () => {
    const state = inEnd();
    state.phase = 'roll';
    state.owners[5] = 'p1';
    const after = act(state, { type: 'PROPOSE_TRADE', trade: trade('p0', 'p1', { money: 10 }, { cells: [5] }) }, { type: 'REJECT_TRADE' });
    expect(after.phase).toBe('roll');
    expect(after.owners[5]).toBe('p1');
    expect(after.players[0].money).toBe(START_MONEY);
  });

  it('the received mortgaged cell can be redeemed as usual', () => {
    const state = inEnd();
    state.owners[5] = 'p1';
    state.mortgaged[5] = true;
    const after = act(state, { type: 'PROPOSE_TRADE', trade: trade('p0', 'p1', { money: 50 }, { cells: [5] }) }, { type: 'ACCEPT_TRADE' }, { type: 'UNMORTGAGE', index: 5 });
    expect(after.mortgaged[5]).toBeUndefined();
    expect(after.players[0].money).toBe(START_MONEY - 50 - 110);
  });

  it('refuses invalid trades', () => {
    const state = inEnd();
    state.owners[1] = 'p0';
    state.owners[3] = 'p0';
    state.buildings[1] = 1;
    state.owners[5] = 'p1';
    const invalid: Trade[] = [
      trade('p0', 'p1', { cells: [3] }, { cells: [5] }), // в квартале есть постройка
      trade('p0', 'p1', { cells: [5] }, {}), // не своя клетка
      trade('p0', 'p1', { money: START_MONEY + 1 }, {}), // больше наличных
      trade('p0', 'p1', {}, { money: START_MONEY + 1 }),
      trade('p0', 'p1', { money: -10 }, { cells: [5] }),
      trade('p0', 'p1', { money: 1.5 }, { cells: [5] }),
      trade('p0', 'p1', {}, {}), // пустой
      trade('p0', 'p0', { money: 10 }, {}),
      trade('p1', 'p0', { cells: [5] }, {}), // не его ход
      trade('p0', 'p1', { releaseCards: ['net-05'] }, {}), // нет такой карточки
      trade('p0', 'p1', {}, { cells: [5, 5] }),
    ];
    for (const t of invalid) expect(propose(state, t)).toBe(state);

    const bankrupt = inEnd();
    bankrupt.players[1].bankrupt = true;
    expect(propose(bankrupt, trade('p0', 'p1', { money: 10 }, {}))).toBe(bankrupt);
  });

  it('only in own turn phases: not while buying, in debt, drawing a card or in another trade', () => {
    for (const phase of ['buyDecision', 'card', 'debt', 'auction', 'gameOver'] as const) {
      const state = inEnd();
      state.phase = phase;
      if (phase === 'debt') state.debt = { from: 'p0', to: null, amount: 10, queue: [], then: 'finish' };
      expect(propose(state, trade('p0', 'p1', { money: 10 }, {}))).toBe(state);
    }
    const pending = propose(inEnd(), trade('p0', 'p1', { money: 10 }, {}));
    expect(propose(pending, trade('p0', 'p2', { money: 10 }, {}))).toBe(pending);
  });

  it('one proposal to the same player per round', () => {
    const state = inEnd();
    const t = trade('p0', 'p1', { money: 10 }, {});
    const rejected = act(state, { type: 'PROPOSE_TRADE', trade: t }, { type: 'REJECT_TRADE' });
    expect(propose(rejected, t)).toBe(rejected);
    expect(propose(rejected, trade('p0', 'p2', { money: 10 }, {})).phase).toBe('trade');
    rejected.round += 1;
    expect(propose(rejected, t).phase).toBe('trade');
  });

  it('accept is refused if the assets are gone (e.g. after a timeout fine)', () => {
    const state = propose(inEnd(), trade('p0', 'p1', {}, { money: START_MONEY }));
    state.players[1].money -= 50;
    expect(applyAction(state, { type: 'ACCEPT_TRADE' })).toBe(state);
    expect(decideBotAction(state)).toEqual({ type: 'REJECT_TRADE' });
  });

  it('a trade can hand over a monopoly, and then the owner may build', () => {
    const state = inEnd();
    state.owners[1] = 'p0';
    state.owners[3] = 'p1';
    const after = act(state, { type: 'PROPOSE_TRADE', trade: trade('p0', 'p1', { money: 400 }, { cells: [3] }) }, { type: 'ACCEPT_TRADE' });
    expect(canBuild(after, 1)).toBe(true);
  });

  it('cells received in a trade go to the creditor on bankruptcy', () => {
    let state = inEnd();
    state.owners[5] = 'p1';
    state = act(state, { type: 'PROPOSE_TRADE', trade: trade('p0', 'p1', { money: START_MONEY }, { cells: [5] }) }, { type: 'ACCEPT_TRADE' }, { type: 'END_TURN' });
    // p1 ходит, затем p2 владеет районом с рентой, на который встаёт p0 без денег
    state.owners[39] = 'p2';
    state.buildings[39] = 5;
    state.owners[37] = 'p2';
    state.buildings[37] = 5;
    state.currentPlayer = 0;
    state.players[0].position = 35;
    resolveRoll(state, [2, 2]);
    expect(state.players[0].bankrupt).toBe(true);
    expect(state.owners[5]).toBe('p2');
  });

  it('timeout of a human addressee fines them and the bot answers for them', () => {
    const state = inEnd();
    state.currentPlayer = 1;
    state.owners[3] = 'p0';
    const proposed = propose(state, trade('p1', 'p0', { money: 10 }, { cells: [3] }));
    expect(actingPlayer(proposed).id).toBe('p0');
    const after = applyAction(proposed, { type: 'TIMEOUT' });
    expect(after.players[0].money).toBe(START_MONEY - 50);
    expect(after.players[0].idleStrikes).toBe(1);
    expect(after.phase).toBe('end');
    expect(after.owners[3]).toBe('p0'); // бот за человека невыгодную сделку отклонил
  });
});

describe('боты и обмен (E3)', () => {
  function botsInEnd(): GameState {
    const state = newGame(2);
    state.currentPlayer = 1;
    state.phase = 'end';
    return state;
  }

  it('accepts a profitable cash deal and rejects giving away a monopoly for nothing', () => {
    const state = newGame(2);
    state.phase = 'end';
    state.owners[5] = 'p1';
    state.owners[1] = 'p0';
    state.owners[3] = 'p1';
    const good = propose(state, trade('p0', 'p1', { money: 300 }, { cells: [5] }));
    expect(decideBotAction(good)).toEqual({ type: 'ACCEPT_TRADE' });
    const gift = propose(state, trade('p0', 'p2', { money: 10 }, {}));
    expect(decideBotAction(gift)).toEqual({ type: 'ACCEPT_TRADE' });
    const monopoly = propose(state, trade('p0', 'p1', { money: 70 }, { cells: [3] }));
    expect(decideBotAction(monopoly)).toEqual({ type: 'REJECT_TRADE' });
  });

  it('proposes a swap of monopolies with an extra payment the partner accepts', () => {
    const state = botsInEnd();
    state.players[0].isBot = true;
    state.owners[37] = 'p1';
    state.owners[39] = 'p0';
    state.owners[1] = 'p1';
    state.owners[3] = 'p0';
    const action = decideBotAction(state)!;
    expect(action.type).toBe('PROPOSE_TRADE');
    const t = (action as Extract<Action, { type: 'PROPOSE_TRADE' }>).trade;
    expect(t).toMatchObject({ from: 'p1', to: 'p0', give: { cells: [1] }, take: { cells: [39] } });
    expect(t.give.money).toBeGreaterThan(0);
    expect(tradeGain(state, t, 'p0')).toBeGreaterThanOrEqual(tradeGain(state, t, 'p1'));

    const proposed = applyAction(state, action);
    expect(decideBotAction(proposed)).toEqual({ type: 'ACCEPT_TRADE' });
    const done = applyAction(proposed, { type: 'ACCEPT_TRADE' });
    expect(done.owners[37]).toBe('p1');
    expect(done.owners[39]).toBe('p1');
    expect(done.owners[1]).toBe('p0');
    expect(done.owners[3]).toBe('p0');
    // после сделки бот строится на новой монополии
    expect(decideBotAction(done)).toMatchObject({ type: 'BUILD' });
  });

  it('offers cash for the last cell of a group and does not repeat during the cooldown', () => {
    const state = botsInEnd();
    state.owners[21] = 'p1';
    state.owners[23] = 'p1';
    state.owners[24] = 'p0';
    const action = decideBotAction(state) as Extract<Action, { type: 'PROPOSE_TRADE' }>;
    expect(action.type).toBe('PROPOSE_TRADE');
    expect(action.trade).toMatchObject({ give: { cells: [] }, take: { cells: [24] } });
    const cell = BOARD[24] as OwnableCell;
    expect(action.trade.give.money).toBeGreaterThan(cell.price);

    const rejected = act(state, action, { type: 'REJECT_TRADE' });
    expect(decideBotAction(rejected)).toEqual({ type: 'END_TURN' });
    rejected.round += 4;
    expect(decideBotAction(rejected)).toEqual({ type: 'END_TURN' });
    rejected.round += 1;
    expect(decideBotAction(rejected)!.type).toBe('PROPOSE_TRADE');
  });

  it('does not propose when it would drop below the cash reserve', () => {
    const poor = botsInEnd();
    poor.owners[21] = 'p1';
    poor.owners[23] = 'p1';
    poor.owners[24] = 'p0';
    poor.players[1].money = 500;
    expect(decideBotAction(poor)).toEqual({ type: 'END_TURN' });
  });

  it('values a mortgaged cell below a free one', () => {
    const state = newGame(2);
    state.owners[5] = 'p1';
    const t = trade('p0', 'p1', { money: 150 }, { cells: [5] });
    const before = tradeGain(state, t, 'p0');
    state.mortgaged[5] = true;
    expect(tradeGain(state, t, 'p0')).toBe(before - mortgageValue(BOARD[5] as OwnableCell));
  });
});

describe('партии ботов с торгами и обменом (E2, E3)', () => {
  it('bots auction, trade and finish games', () => {
    const seen = new Set<string>();
    let finished = 0;
    for (const seed of [1, 2, 3, 4, 5]) {
      const state = playOut(createGame({ playerName: 'Тест', bots: 3, seed }), seen);
      if (state.phase === 'gameOver') {
        finished++;
        expect(state.winnerId).not.toBeNull();
      }
    }
    for (const type of ['START_AUCTION', 'BID', 'PASS', 'PROPOSE_TRADE', 'ACCEPT_TRADE', 'BUILD']) expect(seen).toContain(type);
    expect(finished).toBeGreaterThanOrEqual(4);
  });

  it('same seed — same game', () => {
    const a = playOut(createGame({ playerName: 'Тест', bots: 3, seed: 9 }), new Set(), 3000);
    const b = playOut(createGame({ playerName: 'Тест', bots: 3, seed: 9 }), new Set(), 3000);
    expect(a).toEqual(b);
  });
});
