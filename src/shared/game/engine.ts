import {
  BAIL,
  BOARD,
  DOUBLES_TO_ISOLATION,
  ISOLATION_ATTEMPTS,
  ISOLATION_INDEX,
  TOWER_LEVEL,
  TRANSIT_RENT,
  UTILITY_MULTIPLIERS,
  isOwnable,
} from './board';
import { decideBotAction } from './bot';
import { CARD_BY_ID, DECK_NAMES, deckCardIds } from './cards';
import {
  actingPlayer,
  buildCost,
  buildingLevel,
  buildingSellValue,
  canBid,
  canBuild,
  canMortgage,
  canProposeTrade,
  canSellBuilding,
  canUnmortgage,
  gameMode,
  hasMonopoly,
  liquidationValue,
  minBid,
  mortgageValue,
  netWorth,
  rentMultiplier,
  sellBuildingResult,
  tradeAssetsValid,
  tradeKey,
  unmortgageCost,
} from './economy';
import { DEFAULT_MODE, MODES, type GameModeId } from './modes';
import { rollDie, shuffle } from './rng';
import type {
  Action,
  Card,
  CardDeck,
  Debt,
  GameState,
  LogKind,
  OwnableCell,
  Payment,
  Player,
  PlayerStats,
  TradeOffer,
} from './types';

export { actingPlayer } from './economy';

const LOG_LIMIT = 150;
/** Столько последних перемещений хранится для анимации. */
const MOVE_LIMIT = 8;
const PLAYER_COLORS = ['#3ee6ff', '#ff2e9a', '#ffe14d', '#2eff8c'];
const BOT_NAMES = ['Бот Глитч', 'Бот Неон', 'Бот Хэш'];

export interface NewGameOptions {
  playerName: string;
  bots: number;
  seed?: number;
  mode?: GameModeId;
  /** ежедневный бонус (dailyBonus.ts) — прибавляется к стартовым деньгам человека */
  startBonus?: number;
}

function emptyStats(money: number): PlayerStats {
  return { rentPaid: 0, rentReceived: 0, cellsBought: 0, auctionsWon: 0, trades: 0, built: 0, potCollected: 0, peakWorth: money, out: null };
}

export function createGame({ playerName, bots, seed, mode = DEFAULT_MODE, startBonus = 0 }: NewGameOptions): GameState {
  const { startMoney } = MODES[mode];
  const players: Player[] = [
    { id: 'p0', name: playerName, isBot: false, color: PLAYER_COLORS[0], money: startMoney + startBonus, position: 0, bankrupt: false, releaseCards: [], isolation: null, idleStrikes: 0 },
  ];
  for (let i = 0; i < bots; i++) {
    players.push({
      id: `p${i + 1}`,
      name: BOT_NAMES[i],
      isBot: true,
      color: PLAYER_COLORS[i + 1],
      money: startMoney,
      position: 0,
      bankrupt: false,
      releaseCards: [],
      isolation: null,
      idleStrikes: 0,
    });
  }
  const [hack, s1] = shuffle(deckCardIds('hack'), seed ?? Math.floor(Math.random() * 2 ** 31));
  const [net, s2] = shuffle(deckCardIds('net'), s1);
  const state: GameState = {
    mode,
    round: 1,
    players,
    currentPlayer: 0,
    phase: 'roll',
    dice: null,
    rolledDouble: false,
    doublesInRow: 0,
    owners: {},
    buildings: {},
    mortgaged: {},
    pot: 0,
    debt: null,
    auction: null,
    trade: null,
    tradeRounds: {},
    decks: { hack, net },
    pendingCard: null,
    seed: s2,
    rollCount: 0,
    moves: [],
    stats: Object.fromEntries(players.map((p) => [p.id, emptyStats(p.money)])),
    log: [],
    logCounter: 0,
    winnerId: null,
  };
  log(state, `Игра началась, режим «${MODES[mode].name}». Первым ходит ${players[0].name}.`, 'system');
  if (startBonus > 0) log(state, `${players[0].name} получает ежедневный бонус ${startBonus}₵.`, 'money', players[0]);
  return state;
}

export function currentPlayer(state: GameState): Player {
  return state.players[state.currentPlayer];
}

export function applyAction(prev: GameState, action: Action): GameState {
  if (action.type === 'TIMEOUT') return trackPeaks(timeout(prev));
  const next = reduce(prev, action);
  if (next === prev) return prev;
  // Любое своё действие обнуляет счётчик таймаутов того, кто принимал решение.
  playerById(next, actingPlayer(prev).id).idleStrikes = 0;
  return trackPeaks(next);
}

/** Обновляет пиковый капитал живых игроков для итогов партии. */
function trackPeaks(state: GameState): GameState {
  for (const player of state.players) {
    if (player.bankrupt) continue;
    const stats = state.stats[player.id];
    stats.peakWorth = Math.max(stats.peakWorth, netWorth(state, player));
  }
  return state;
}

/**
 * Время на решение вышло: штраф наличными в копилку (без долга и банкротства), затем за игрока
 * действует бот. После idleStrikesLimit таймаутов подряд игрок насовсем передаётся боту.
 */
function timeout(prev: GameState): GameState {
  if (prev.phase === 'gameOver') return prev;
  const state = structuredClone(prev);
  const mode = gameMode(state);
  const player = actingPlayer(state);
  const fine = Math.min(mode.idleFine, Math.max(player.money, 0));
  transfer(state, player, null, fine);
  player.idleStrikes += 1;
  log(state, `${player.name} не успевает с решением${fine > 0 ? ` и платит штраф ${fine}₵ в Нейтральную зону` : ''}.`, 'money', player);
  if (!player.isBot && player.idleStrikes >= mode.idleStrikesLimit) {
    player.isBot = true;
    log(state, `${player.name} слишком долго молчит — управление перехватывает бот.`, 'system', player);
  }
  const fallback = decideBotAction(state);
  return fallback ? reduce(state, fallback) : state;
}

function reduce(prev: GameState, action: Action): GameState {
  if (prev.phase === 'gameOver') return prev;
  switch (action.type) {
    case 'ROLL': {
      if (prev.phase !== 'roll' && prev.phase !== 'isolation') return prev;
      const state = structuredClone(prev);
      const [d1, s1] = rollDie(state.seed);
      const [d2, s2] = rollDie(s1);
      state.seed = s2;
      resolveRoll(state, [d1, d2]);
      return state;
    }
    case 'BUY': {
      if (prev.phase !== 'buyDecision') return prev;
      const state = structuredClone(prev);
      const player = currentPlayer(state);
      const cell = BOARD[player.position] as OwnableCell;
      player.money -= cell.price;
      state.owners[cell.index] = player.id;
      state.stats[player.id].cellsBought += 1;
      log(state, `${player.name} покупает «${cell.name}» за ${cell.price}₵.`, 'deal', player);
      finishMove(state);
      return state;
    }
    case 'START_AUCTION': {
      if (prev.phase !== 'buyDecision') return prev;
      const state = structuredClone(prev);
      const player = currentPlayer(state);
      log(state, `${player.name} отказывается от покупки «${BOARD[player.position].name}» — клетка уходит на торги.`, 'deal', player);
      startAuction(state);
      return state;
    }
    case 'BID': {
      if (!canBid(prev, action.amount)) return prev;
      const state = structuredClone(prev);
      const auction = state.auction!;
      const bidder = actingPlayer(state);
      auction.bid = action.amount;
      auction.leaderId = bidder.id;
      auction.queue.push(auction.queue.shift()!);
      log(state, `${bidder.name} ставит ${action.amount}₵.`, 'deal', bidder);
      advanceAuction(state);
      return state;
    }
    case 'PASS': {
      if (prev.phase !== 'auction' || !prev.auction) return prev;
      const state = structuredClone(prev);
      const player = actingPlayer(state);
      state.auction!.queue.shift();
      log(state, `${player.name} пасует и выходит из торгов.`, 'deal', player);
      advanceAuction(state);
      return state;
    }
    case 'PROPOSE_TRADE': {
      if (!canProposeTrade(prev, action.trade)) return prev;
      const state = structuredClone(prev);
      const trade = structuredClone(action.trade);
      state.tradeRounds[tradeKey(trade.from, trade.to)] = state.round;
      state.trade = { ...trade, resume: state.phase };
      state.phase = 'trade';
      const from = playerById(state, trade.from);
      const to = playerById(state, trade.to);
      log(state, `${from.name} предлагает обмен игроку ${to.name}: отдаёт ${offerText(trade.give)}, просит ${offerText(trade.take)}.`, 'deal', from, to);
      return state;
    }
    case 'ACCEPT_TRADE': {
      if (prev.phase !== 'trade' || !prev.trade || !tradeAssetsValid(prev, prev.trade)) return prev;
      const state = structuredClone(prev);
      const trade = state.trade!;
      const from = playerById(state, trade.from);
      const to = playerById(state, trade.to);
      handOver(state, from, to, trade.give);
      handOver(state, to, from, trade.take);
      state.trade = null;
      state.phase = trade.resume;
      state.stats[from.id].trades += 1;
      state.stats[to.id].trades += 1;
      log(state, `${to.name} принимает обмен с игроком ${from.name}.`, 'deal', to, from);
      return state;
    }
    case 'REJECT_TRADE': {
      if (prev.phase !== 'trade' || !prev.trade) return prev;
      const state = structuredClone(prev);
      const trade = state.trade!;
      state.trade = null;
      state.phase = trade.resume;
      const from = playerById(state, trade.from);
      const to = playerById(state, trade.to);
      log(state, `${to.name} отклоняет обмен с игроком ${from.name}.`, 'deal', to, from);
      return state;
    }
    case 'APPLY_CARD': {
      if (prev.phase !== 'card' || prev.pendingCard === null) return prev;
      const state = structuredClone(prev);
      const card = CARD_BY_ID[state.pendingCard!];
      state.pendingCard = null;
      applyCard(state, card);
      return state;
    }
    case 'PAY_BAIL': {
      if (prev.phase !== 'isolation' || currentPlayer(prev).money < BAIL) return prev;
      const state = structuredClone(prev);
      const player = currentPlayer(state);
      log(state, `${player.name} платит залог ${BAIL}₵ и выходит из Изолятора.`, 'move', player);
      transfer(state, player, null, BAIL);
      release(state, player);
      return state;
    }
    case 'USE_RELEASE_CARD': {
      if (prev.phase !== 'isolation' || currentPlayer(prev).releaseCards.length === 0) return prev;
      const state = structuredClone(prev);
      const player = currentPlayer(state);
      const id = player.releaseCards.shift()!;
      state.decks[CARD_BY_ID[id].deck].push(id);
      log(state, `${player.name} использует карточку освобождения и выходит из Изолятора.`, 'move', player);
      release(state, player);
      return state;
    }
    case 'BUILD': {
      if (!canBuild(prev, action.index)) return prev;
      const state = structuredClone(prev);
      const player = actingPlayer(state);
      const cost = buildCost(action.index);
      const level = buildingLevel(state, action.index) + 1;
      player.money -= cost;
      state.buildings[action.index] = level;
      state.stats[player.id].built += 1;
      const what = level === TOWER_LEVEL ? 'небоскрёб' : `модуль ${level}`;
      log(state, `${player.name} строит ${what} в «${BOARD[action.index].name}» за ${cost}₵.`, 'deal', player);
      return state;
    }
    case 'SELL_BUILDING': {
      if (!canSellBuilding(prev, action.index)) return prev;
      const state = structuredClone(prev);
      const player = actingPlayer(state);
      const { level, refund } = sellBuildingResult(state, action.index);
      player.money += refund;
      if (level > 0) state.buildings[action.index] = level;
      else delete state.buildings[action.index];
      log(state, `${player.name} продаёт постройку в «${BOARD[action.index].name}» банку за ${refund}₵.`, 'deal', player);
      return state;
    }
    case 'MORTGAGE': {
      if (!canMortgage(prev, action.index)) return prev;
      const state = structuredClone(prev);
      const player = actingPlayer(state);
      const cell = BOARD[action.index] as OwnableCell;
      player.money += mortgageValue(cell);
      state.mortgaged[cell.index] = true;
      log(state, `${player.name} закладывает «${cell.name}» и получает ${mortgageValue(cell)}₵.`, 'deal', player);
      return state;
    }
    case 'UNMORTGAGE': {
      if (!canUnmortgage(prev, action.index)) return prev;
      const state = structuredClone(prev);
      const player = actingPlayer(state);
      const cell = BOARD[action.index] as OwnableCell;
      player.money -= unmortgageCost(cell);
      delete state.mortgaged[cell.index];
      log(state, `${player.name} выкупает «${cell.name}» из залога за ${unmortgageCost(cell)}₵.`, 'deal', player);
      return state;
    }
    case 'PAY_DEBT': {
      if (prev.phase !== 'debt' || !prev.debt || actingPlayer(prev).money < prev.debt.amount) return prev;
      const state = structuredClone(prev);
      const debt = state.debt!;
      state.debt = null;
      const from = playerById(state, debt.from);
      const to = debt.to === null ? null : playerById(state, debt.to);
      pay(state, debt, from, to);
      log(state, `${from.name} расплачивается: ${debt.amount}₵ ${to ? `игроку ${to.name}` : 'банку'}.`, 'money', from, to);
      settle(state, debt.queue, debt.then);
      return state;
    }
    case 'DECLARE_BANKRUPTCY': {
      if (prev.phase !== 'debt' || !prev.debt) return prev;
      const state = structuredClone(prev);
      const debt = state.debt!;
      state.debt = null;
      bankrupt(state, playerById(state, debt.from), debt.to === null ? null : playerById(state, debt.to));
      settle(state, debt.queue, debt.then);
      return state;
    }
    case 'END_TURN': {
      if (prev.phase !== 'end') return prev;
      const state = structuredClone(prev);
      nextPlayer(state);
      return state;
    }
    case 'TIMEOUT':
      // Обрабатывается в applyAction; бот этот Action не выбирает.
      return prev;
  }
}

/** Moves the current player by the given dice and resolves the landing cell. Mutates state. */
export function resolveRoll(state: GameState, dice: [number, number]): void {
  const player = currentPlayer(state);
  const [d1, d2] = dice;
  state.dice = dice;
  state.rolledDouble = d1 === d2;
  state.rollCount += 1;
  log(state, `${player.name} бросает ${d1} и ${d2}${state.rolledDouble ? ' — дубль!' : '.'}`, 'move', player);
  if (player.isolation) {
    rollInIsolation(state, player);
    return;
  }
  if (state.rolledDouble) {
    state.doublesInRow += 1;
    if (state.doublesInRow >= DOUBLES_TO_ISOLATION) {
      log(state, `${DOUBLES_TO_ISOLATION} дубля подряд — дроны безопасности засекли ${player.name}.`, 'move', player);
      sendToIsolation(state, player);
      finishMove(state);
      return;
    }
  }
  moveBy(state, player, d1 + d2);
  landOn(state);
}

/** Бросок из Изолятора: дубль освобождает без повторного хода, после последней неудачи — принудительный залог. */
function rollInIsolation(state: GameState, player: Player): void {
  const isolation = player.isolation!;
  if (state.rolledDouble) {
    log(state, `${player.name} выбрасывает дубль и выходит из Изолятора.`, 'move', player);
    leaveIsolationAndMove(state);
    return;
  }
  isolation.turnsLeft -= 1;
  if (isolation.turnsLeft > 0) {
    log(state, `Дубля нет — ${player.name} остаётся в Изоляторе. Попыток: ${isolation.turnsLeft}.`, 'move', player);
    finishMove(state);
    return;
  }
  log(state, `Попытки кончились: ${player.name} платит залог ${BAIL}₵.`, 'move', player);
  settle(state, [{ from: player.id, to: null, amount: BAIL }], 'move');
}

/** Выход из Изолятора броском: фишка идёт на сумму кубиков, повторного хода нет. */
function leaveIsolationAndMove(state: GameState): void {
  const player = currentPlayer(state);
  if (player.bankrupt) {
    finishMove(state);
    return;
  }
  player.isolation = null;
  state.rolledDouble = false;
  moveBy(state, player, diceSum(state));
  landOn(state);
}

/** Resolves the cell the current player stands on. Ends with a decision phase or finishMove. */
function landOn(state: GameState): void {
  const player = currentPlayer(state);
  const cell = BOARD[player.position];
  log(state, `${player.name} попадает на «${cell.name}».`, 'move', player);

  if (isOwnable(cell)) {
    const ownerId = state.owners[cell.index];
    if (ownerId === undefined) {
      if (player.money >= cell.price) {
        state.phase = 'buyDecision';
        return;
      }
      log(state, `У ${player.name} не хватает денег на покупку — «${cell.name}» уходит на торги.`, 'deal', player);
      startAuction(state);
      return;
    } else if (ownerId !== player.id && state.mortgaged[cell.index]) {
      log(state, `«${cell.name}» в залоге — рента не берётся.`, 'money', player, playerById(state, ownerId));
    } else if (ownerId !== player.id) {
      const rent = calculateRent(state, cell, diceSum(state));
      const owner = playerById(state, ownerId);
      log(state, `${player.name} платит ренту ${rent}₵ игроку ${owner.name}.`, 'money', player, owner);
      settle(state, [{ from: player.id, to: owner.id, amount: rent, rent: true }], 'finish');
      return;
    }
  } else if (cell.kind === 'tax') {
    log(state, `${player.name} платит ${cell.amount}₵.`, 'money', player);
    settle(state, [{ from: player.id, to: null, amount: cell.amount }], 'finish');
    return;
  } else if (cell.kind === 'goToIsolation') {
    sendToIsolation(state, player);
  } else if (cell.kind === 'hack' || cell.kind === 'net') {
    drawCard(state, cell.kind);
    return;
  } else if (cell.kind === 'neutral') {
    collectPot(state, player);
  }

  finishMove(state);
}

/**
 * Торги за клетку под текущим игроком. Участвуют все живые: первым решает следующий по ходу,
 * отказавшийся от покупки — последним.
 */
function startAuction(state: GameState): void {
  const current = state.currentPlayer;
  const queue: string[] = [];
  for (let i = 1; i <= state.players.length; i++) {
    const player = state.players[(current + i) % state.players.length];
    if (!player.bankrupt) queue.push(player.id);
  }
  state.auction = { index: currentPlayer(state).position, bid: 0, leaderId: null, queue };
  state.phase = 'auction';
  advanceAuction(state);
}

/**
 * Выводит из торгов тех, кому не хватает наличных на минимальную ставку, и подводит итог:
 * остался один лидер — клетка его, не осталось никого — клетка остаётся у банка.
 */
function advanceAuction(state: GameState): void {
  const auction = state.auction!;
  while (auction.queue.length > 0 && auction.queue[0] !== auction.leaderId) {
    const player = playerById(state, auction.queue[0]);
    if (player.money >= minBid(auction)) break;
    auction.queue.shift();
    log(state, `${player.name} выбывает из торгов: не хватает наличных.`, 'deal', player);
  }
  const cell = BOARD[auction.index];
  if (auction.queue.length === 0) {
    state.auction = null;
    log(state, `Никто не сделал ставку — «${cell.name}» остаётся у банка.`, 'deal');
    finishMove(state);
  } else if (auction.queue.length === 1 && auction.queue[0] === auction.leaderId) {
    const winner = playerById(state, auction.leaderId);
    winner.money -= auction.bid;
    state.owners[auction.index] = winner.id;
    state.auction = null;
    state.stats[winner.id].cellsBought += 1;
    state.stats[winner.id].auctionsWon += 1;
    log(state, `${winner.name} выигрывает торги и получает «${cell.name}» за ${auction.bid}₵.`, 'deal', winner);
    finishMove(state);
  }
}

function offerText(offer: TradeOffer): string {
  const parts = offer.cells.map((i) => `«${BOARD[i].name}»`);
  if (offer.money > 0) parts.push(`${offer.money}₵`);
  if (offer.releaseCards.length > 0) parts.push(`карточки освобождения: ${offer.releaseCards.length}`);
  return parts.length > 0 ? parts.join(', ') : 'ничего';
}

/** Передача по обмену: клетки уходят вместе с залогом, деньги и карточки — как есть. */
function handOver(state: GameState, from: Player, to: Player, offer: TradeOffer): void {
  for (const index of offer.cells) state.owners[index] = to.id;
  from.money -= offer.money;
  to.money += offer.money;
  from.releaseCards = from.releaseCards.filter((id) => !offer.releaseCards.includes(id));
  to.releaseCards.push(...offer.releaseCards);
}

function collectPot(state: GameState, player: Player): void {
  if (state.pot === 0) {
    log(state, 'Копилка Нейтральной зоны пуста.', 'money', player);
    return;
  }
  log(state, `${player.name} забирает копилку Нейтральной зоны: ${state.pot}₵.`, 'money', player);
  player.money += state.pot;
  state.stats[player.id].potCollected += state.pot;
  state.pot = 0;
}

function drawCard(state: GameState, deck: CardDeck): void {
  const player = currentPlayer(state);
  const id = state.decks[deck].shift();
  if (id === undefined) {
    log(state, `Колода «${DECK_NAMES[deck]}» пуста.`, 'move', player);
    finishMove(state);
    return;
  }
  const card = CARD_BY_ID[id];
  // Карточка освобождения остаётся у игрока и вернётся в колоду после использования.
  if (card.effect.type !== 'getOutOfIsolation') state.decks[deck].push(id);
  state.pendingCard = id;
  state.phase = 'card';
  log(state, `${player.name} тянет «${DECK_NAMES[deck]}»: ${card.text}`, 'move', player);
}

function applyCard(state: GameState, card: Card): void {
  const player = currentPlayer(state);
  const effect = card.effect;
  switch (effect.type) {
    case 'money':
      if (effect.amount < 0) {
        settle(state, [{ from: player.id, to: null, amount: -effect.amount }], 'finish');
        return;
      }
      player.money += effect.amount;
      break;
    case 'moveTo':
      if (effect.index < player.position) paySalary(state, player);
      recordMove(state, player, effect.index, (effect.index - player.position + BOARD.length) % BOARD.length);
      player.position = effect.index;
      landOn(state);
      return;
    case 'moveBy':
      moveBy(state, player, effect.steps);
      landOn(state);
      return;
    case 'goToIsolation':
      sendToIsolation(state, player);
      break;
    case 'payEachPlayer': {
      const payments = opponents(state, player).map((o) => ({ from: player.id, to: o.id, amount: effect.amount }));
      settle(state, payments, 'finish');
      return;
    }
    case 'collectFromEachPlayer': {
      const payments = opponents(state, player).map((o) => ({ from: o.id, to: player.id, amount: effect.amount }));
      settle(state, payments, 'finish');
      return;
    }
    case 'getOutOfIsolation':
      player.releaseCards.push(card.id);
      log(state, `${player.name} сохраняет карточку освобождения.`, 'move', player);
      break;
    case 'repairs': {
      const cost = repairsCost(state, player, effect.perModule, effect.perTower);
      log(state, `${player.name} платит за ремонт ${cost}₵.`, 'money', player);
      settle(state, [{ from: player.id, to: null, amount: cost }], 'finish');
      return;
    }
  }
  finishMove(state);
}

/**
 * Заложенная клетка ренты не приносит. Монополия без построек удваивает базовую ренту района.
 * В режиме «Инфляция» итог умножается на rentMultiplier.
 */
export function calculateRent(state: GameState, cell: OwnableCell, diceSum: number): number {
  const ownerId = state.owners[cell.index];
  if (ownerId === undefined || state.mortgaged[cell.index]) return 0;
  return baseRent(state, cell, ownerId, diceSum) * rentMultiplier(state);
}

function baseRent(state: GameState, cell: OwnableCell, ownerId: string, diceSum: number): number {
  if (cell.kind === 'district') {
    const level = buildingLevel(state, cell.index);
    if (level > 0) return cell.rent[level];
    return hasMonopoly(state, cell.group, ownerId) ? cell.rent[0] * 2 : cell.rent[0];
  }
  const sameKindOwned = BOARD.filter(
    (c) => c.kind === cell.kind && state.owners[c.index] === ownerId,
  ).length;
  if (cell.kind === 'transit') return TRANSIT_RENT[sameKindOwned - 1];
  return diceSum * UTILITY_MULTIPLIERS[sameKindOwned - 1];
}

function repairsCost(state: GameState, player: Player, perModule: number, perTower: number): number {
  let cost = 0;
  for (const [index, level] of Object.entries(state.buildings)) {
    if (state.owners[Number(index)] !== player.id) continue;
    cost += level >= TOWER_LEVEL ? perTower : level * perModule;
  }
  return cost;
}

function diceSum(state: GameState): number {
  return state.dice ? state.dice[0] + state.dice[1] : 0;
}

/** Forward moves past Start pay salary; backward moves wrap without it. */
function moveBy(state: GameState, player: Player, steps: number): void {
  const target = player.position + steps;
  if (target >= BOARD.length) paySalary(state, player);
  const to = ((target % BOARD.length) + BOARD.length) % BOARD.length;
  recordMove(state, player, to, steps);
  player.position = to;
}

/** Запоминает перемещение фишки для анимации; steps: > 0 вперёд, < 0 назад, 0 — перенос. */
function recordMove(state: GameState, player: Player, to: number, steps: number): void {
  const id = (state.moves.at(-1)?.id ?? 0) + 1;
  state.moves.push({ id, playerId: player.id, from: player.position, to, steps });
  if (state.moves.length > MOVE_LIMIT) state.moves.splice(0, state.moves.length - MOVE_LIMIT);
}

function paySalary(state: GameState, player: Player): void {
  const { salary } = gameMode(state);
  player.money += salary;
  log(state, `${player.name} проходит Старт и получает ${salary}₵.`, 'money', player);
}

function sendToIsolation(state: GameState, player: Player): void {
  recordMove(state, player, ISOLATION_INDEX, 0);
  player.position = ISOLATION_INDEX;
  player.isolation = { turnsLeft: ISOLATION_ATTEMPTS };
  state.rolledDouble = false;
  state.doublesInRow = 0;
  log(state, `${player.name} отправляется в Изолятор.`, 'move', player);
}

/** Выход из Изолятора до броска: дальше обычный ход. */
function release(state: GameState, player: Player): void {
  player.isolation = null;
  state.phase = 'roll';
}

function opponents(state: GameState, player: Player): Player[] {
  return state.players.filter((p) => p !== player && !p.bankrupt);
}

function playerById(state: GameState, id: string): Player {
  return state.players.find((p) => p.id === id)!;
}

/** Платёж без получателя — штраф: деньги уходят в копилку «Нейтральной зоны». */
function transfer(state: GameState, from: Player, to: Player | null, amount: number): void {
  from.money -= amount;
  if (to) to.money += amount;
  else state.pot += amount;
}

/** Проводит обязательный платёж и учитывает ренту в статистике. */
function pay(state: GameState, payment: Payment, from: Player, to: Player | null): void {
  transfer(state, from, to, payment.amount);
  if (payment.rent && to) {
    state.stats[from.id].rentPaid += payment.amount;
    state.stats[to.id].rentReceived += payment.amount;
  }
}

/**
 * Проводит обязательные платежи по очереди, затем продолжает ход (then).
 * Наличных мало, но хватит с продажей построек и залогом — фаза 'debt' до решения должника.
 * Не хватает и этого — должник сразу банкротится перед получателем.
 */
function settle(state: GameState, payments: Payment[], then: Debt['then']): void {
  for (let i = 0; i < payments.length; i++) {
    if (state.phase === 'gameOver') return;
    const payment = payments[i];
    const from = playerById(state, payment.from);
    const to = payment.to === null ? null : playerById(state, payment.to);
    if (from.bankrupt || payment.amount <= 0) continue;
    if (from.money >= payment.amount) {
      pay(state, payment, from, to);
    } else if (liquidationValue(state, from) >= payment.amount) {
      state.debt = { ...payment, queue: payments.slice(i + 1), then };
      state.phase = 'debt';
      const whom = to ? `игроку ${to.name}` : 'банку';
      log(state, `${from.name} должен ${payment.amount}₵ ${whom}: не хватает наличных, нужно продать постройки или заложить собственность.`, 'money', from, to);
      return;
    } else {
      bankrupt(state, from, to);
    }
  }
  if (state.phase === 'gameOver') return;
  if (then === 'move') leaveIsolationAndMove(state);
  else finishMove(state);
}

/** Банкрот отдаёт всё кредитору (постройки — деньгами по цене выкупа банком, клетки — вместе с залогами) или банку. */
function bankrupt(state: GameState, player: Player, creditor: Player | null): void {
  let proceeds = Math.max(player.money, 0);
  for (const [key, ownerId] of Object.entries(state.owners)) {
    if (ownerId !== player.id) continue;
    const index = Number(key);
    proceeds += buildingLevel(state, index) * buildingSellValue(index);
    delete state.buildings[index];
    if (creditor) {
      state.owners[index] = creditor.id;
    } else {
      delete state.owners[index];
      delete state.mortgaged[index];
    }
  }
  if (creditor) {
    creditor.money += proceeds;
    creditor.releaseCards.push(...player.releaseCards);
  } else {
    for (const id of player.releaseCards) state.decks[CARD_BY_ID[id].deck].push(id);
  }
  player.bankrupt = true;
  player.money = 0;
  player.releaseCards = [];
  player.isolation = null;
  const order = state.players.filter((p) => p.bankrupt).length;
  state.stats[player.id].out = { round: state.round, order };
  log(
    state,
    creditor
      ? `${player.name} банкрот и выбывает из игры. Всё имущество переходит игроку ${creditor.name}.`
      : `${player.name} банкрот и выбывает из игры. Имущество возвращается банку.`,
    'system',
    player,
    creditor,
  );

  const alive = state.players.filter((p) => !p.bankrupt);
  if (alive.length === 1) {
    state.phase = 'gameOver';
    state.winnerId = alive[0].id;
    log(state, `${alive[0].name} побеждает!`, 'system', alive[0]);
  }
}

function finishMove(state: GameState): void {
  if (state.phase === 'gameOver') return;
  const player = currentPlayer(state);
  state.phase = state.rolledDouble && !player.bankrupt ? 'roll' : 'end';
}

function nextPlayer(state: GameState): void {
  let next = state.currentPlayer;
  do {
    next = (next + 1) % state.players.length;
  } while (state.players[next].bankrupt);
  // Ход вернулся к первому живому игроку — начинается новый круг.
  if (next <= state.currentPlayer) {
    startRound(state);
    if (state.phase === 'gameOver') return;
  }
  const player = state.players[next];
  state.currentPlayer = next;
  state.phase = player.isolation ? 'isolation' : 'roll';
  state.dice = null;
  state.rolledDouble = false;
  state.doublesInRow = 0;
  log(state, `Ход игрока ${player.name}${player.isolation ? ' (в Изоляторе)' : ''}.`, 'move', player);
}

/** Новый круг: в «Блице» после лимита — конец партии, в «Инфляции» на пороге — рост ренты. */
function startRound(state: GameState): void {
  const mode = gameMode(state);
  if (mode.roundLimit !== null && state.round >= mode.roundLimit) {
    finishByNetWorth(state);
    return;
  }
  const before = rentMultiplier(state);
  state.round += 1;
  const limit = mode.roundLimit !== null ? ` из ${mode.roundLimit}` : '';
  log(state, `Круг ${state.round}${limit}.`, 'system');
  const after = rentMultiplier(state);
  if (after !== before) log(state, `Инфляция! Вся рента в городе теперь ×${after}.`, 'system');
}

/** Лимит кругов: побеждает самый богатый по капиталу, при равенстве — у кого больше наличных, затем кто раньше ходит. */
function finishByNetWorth(state: GameState): void {
  const ranking = standings(state);
  const winner = ranking[0].player;
  log(state, `Лимит кругов исчерпан. Капиталы: ${ranking.map((r) => `${r.player.name} ${r.worth}₵`).join(', ')}.`, 'system');
  state.phase = 'gameOver';
  state.winnerId = winner.id;
  log(state, `${winner.name} побеждает по капиталу!`, 'system', winner);
}

/** Живые игроки по убыванию капитала (netWorth), затем наличных; при равенстве — по порядку хода. */
export function standings(state: GameState): { player: Player; worth: number }[] {
  return state.players
    .filter((p) => !p.bankrupt)
    .map((player) => ({ player, worth: netWorth(state, player) }))
    .sort((a, b) => b.worth - a.worth || b.player.money - a.player.money);
}

export interface PlayerResult {
  /** 1 — победитель */
  place: number;
  player: Player;
  /** капитал на конец партии; у выбывших — 0 */
  worth: number;
  stats: PlayerStats;
}

/**
 * Итоговая таблица: победитель, остальные живые по капиталу (standings),
 * затем выбывшие — кто продержался дольше, тот выше.
 */
export function gameResults(state: GameState): PlayerResult[] {
  const alive = standings(state).sort((a, b) => Number(b.player.id === state.winnerId) - Number(a.player.id === state.winnerId));
  const out = state.players
    .filter((p) => p.bankrupt)
    .sort((a, b) => (state.stats[b.id].out?.order ?? 0) - (state.stats[a.id].out?.order ?? 0))
    .map((player) => ({ player, worth: 0 }));
  return [...alive, ...out].map(({ player, worth }, i) => ({ place: i + 1, player, worth, stats: state.stats[player.id] }));
}

function log(state: GameState, text: string, kind: LogKind, ...who: (Player | null | undefined)[]): void {
  state.logCounter += 1;
  const players = who.filter((p): p is Player => Boolean(p)).map((p) => p.id);
  state.log.push({ id: state.logCounter, text, kind, players });
  if (state.log.length > LOG_LIMIT) state.log.splice(0, state.log.length - LOG_LIMIT);
}
