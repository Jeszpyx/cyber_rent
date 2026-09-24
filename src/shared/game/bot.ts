import { AUCTION_STEP, BAIL, BOARD, GROUP_COLORS, groupCells, isOwnable } from './board';
import {
  EMPTY_OFFER,
  actingPlayer,
  buildCost,
  canBuild,
  canMortgage,
  canProposeTrade,
  canSellBuilding,
  canUnmortgage,
  hasMonopoly,
  minBid,
  mortgageValue,
  ownedCells,
  tradableCells,
  tradeAssetsValid,
  tradeKey,
  unmortgageCost,
} from './economy';
import type { Action, DistrictGroup, GameState, OwnableCell, Trade } from './types';

const BOT_CASH_RESERVE = 200;
/** Строит и выкупает залоги, только если после траты остаётся столько наличных. */
const BOT_BUILD_RESERVE = 300;
/** Пока на поле столько свободных клеток, бот спешит выйти из Изолятора и скупать; позже выгоднее отсидеться. */
const BOT_LEAVE_ISOLATION_FREE_CELLS = 8;
/**
 * Торги: бот ставит до price × k. Выше обычного — если клетка из квартала (или сети монорельса),
 * где у него уже что-то есть, и если она не даёт сопернику собрать квартал.
 */
const BOT_AUCTION_K = 1;
const BOT_AUCTION_K_OWN_GROUP = 1.5;
const BOT_AUCTION_K_BLOCK = 1.25;
/** Первая ставка бота — доля цены клетки, каждое повышение — ещё такая доля (не меньше AUCTION_STEP). */
const BOT_OPENING_BID = 0.5;
const BOT_RAISE = 0.1;
/** Оценка обмена: монополия стоит столько-то сумм цен её клеток сверх самих клеток. */
const BOT_MONOPOLY_WEIGHT = 1;
const BOT_RELEASE_CARD_VALUE = 50;
/** Повторно предлагать обмен тому же игроку — не раньше, чем через столько кругов. */
const BOT_TRADE_COOLDOWN_ROUNDS = 5;

const GROUPS = Object.keys(GROUP_COLORS) as DistrictGroup[];

export function decideBotAction(state: GameState): Action | null {
  switch (state.phase) {
    case 'roll':
      return { type: 'ROLL' };
    case 'isolation':
      return decideInIsolation(state);
    case 'buyDecision': {
      const player = actingPlayer(state);
      const cell = BOARD[player.position] as OwnableCell;
      return player.money - cell.price >= BOT_CASH_RESERVE ? { type: 'BUY' } : { type: 'START_AUCTION' };
    }
    case 'auction':
      return decideInAuction(state);
    case 'card':
      return { type: 'APPLY_CARD' };
    case 'debt':
      return decideInDebt(state);
    case 'trade':
      return decideOnTrade(state);
    case 'end':
      return decideDevelopment(state) ?? decideTradeProposal(state) ?? { type: 'END_TURN' };
    case 'gameOver':
      return null;
  }
}

function decideInIsolation(state: GameState): Action {
  const player = actingPlayer(state);
  const freeCells = BOARD.filter((c) => isOwnable(c) && state.owners[c.index] === undefined).length;
  const early = freeCells >= BOT_LEAVE_ISOLATION_FREE_CELLS;
  // На последней попытке карточка лучше принудительного залога.
  const lastAttempt = player.isolation?.turnsLeft === 1;
  if (player.releaseCards.length > 0 && (early || lastAttempt)) return { type: 'USE_RELEASE_CARD' };
  if (early && player.money - BAIL >= BOT_CASH_RESERVE) return { type: 'PAY_BAIL' };
  return { type: 'ROLL' };
}

/** Во сколько цен бот готов оценить клетку на торгах. */
function auctionFactor(state: GameState, cell: OwnableCell, playerId: string): number {
  const related =
    cell.kind === 'district'
      ? groupCells(cell.group).filter((i) => i !== cell.index)
      : BOARD.filter((c) => c.kind === cell.kind && c.index !== cell.index).map((c) => c.index);
  const owners = related.map((i) => state.owners[i]);
  if (owners.includes(playerId)) return BOT_AUCTION_K_OWN_GROUP;
  // Остальной квартал у одного соперника — клетка у него станет монополией.
  if (cell.kind === 'district' && owners[0] !== undefined && owners.every((o) => o === owners[0])) return BOT_AUCTION_K_BLOCK;
  return BOT_AUCTION_K;
}

const roundToStep = (value: number) => Math.round(value / AUCTION_STEP) * AUCTION_STEP;

/** Открывает с половины цены и повышает шагами по 10% цены, пока не дойдёт до своего предела. */
function decideInAuction(state: GameState): Action {
  const auction = state.auction!;
  const player = actingPlayer(state);
  const cell = BOARD[auction.index] as OwnableCell;
  const limit = Math.min(Math.floor(cell.price * auctionFactor(state, cell, player.id)), player.money - BOT_CASH_RESERVE);
  const wanted =
    auction.bid === 0
      ? roundToStep(cell.price * BOT_OPENING_BID)
      : auction.bid + Math.max(AUCTION_STEP, roundToStep(cell.price * BOT_RAISE));
  const amount = Math.min(Math.max(wanted, minBid(auction)), limit);
  return amount >= minBid(auction) ? { type: 'BID', amount } : { type: 'PASS' };
}

/** Оценка имущества ботом: клетки (заложенные — за вычетом залога) плюс бонус за каждую монополию. */
function assetScore(state: GameState, owners: Record<number, string>, playerId: string): number {
  let score = 0;
  for (const cell of BOARD) {
    if (!isOwnable(cell) || owners[cell.index] !== playerId) continue;
    score += cell.price - (state.mortgaged[cell.index] ? mortgageValue(cell) : 0);
  }
  for (const group of GROUPS) {
    const cells = groupCells(group);
    if (cells.every((i) => owners[i] === playerId)) {
      score += BOT_MONOPOLY_WEIGHT * cells.reduce((sum, i) => sum + (BOARD[i] as OwnableCell).price, 0);
    }
  }
  return score;
}

/** Насколько обмен улучшает положение игрока (одной из сторон) по оценке бота. */
export function tradeGain(state: GameState, trade: Trade, playerId: string): number {
  const owners = { ...state.owners };
  for (const i of trade.give.cells) owners[i] = trade.to;
  for (const i of trade.take.cells) owners[i] = trade.from;
  const sign = playerId === trade.from ? 1 : -1;
  const money = sign * (trade.take.money - trade.give.money);
  const cards = sign * (trade.take.releaseCards.length - trade.give.releaseCards.length) * BOT_RELEASE_CARD_VALUE;
  return assetScore(state, owners, playerId) - assetScore(state, state.owners, playerId) + money + cards;
}

/** Бот соглашается, если сам выигрывает и выигрывает не меньше партнёра. */
function decideOnTrade(state: GameState): Action {
  const trade = state.trade!;
  if (!tradeAssetsValid(state, trade)) return { type: 'REJECT_TRADE' };
  const mine = tradeGain(state, trade, trade.to);
  const theirs = tradeGain(state, trade, trade.from);
  return mine > 0 && mine >= theirs ? { type: 'ACCEPT_TRADE' } : { type: 'REJECT_TRADE' };
}

const roundUpToStep = (value: number) => Math.ceil(value / AUCTION_STEP) * AUCTION_STEP;

/**
 * Бот собирает квартал, где ему не хватает одной клетки: предлагает её владельцу свою клетку,
 * которая закроет квартал уже ему (обмен монополиями), или просто деньги. Доплата подбирается так,
 * чтобы партнёр по оценке бота выигрывал не меньше самого бота.
 */
function decideTradeProposal(state: GameState): Action | null {
  const player = actingPlayer(state);
  const myTradable = tradableCells(state, player.id);
  for (const group of GROUPS) {
    const cells = groupCells(group);
    const missing = cells.filter((i) => state.owners[i] !== player.id);
    if (missing.length !== 1) continue;
    const partnerId = state.owners[missing[0]];
    if (partnerId === undefined) continue;
    const last = state.tradeRounds[tradeKey(player.id, partnerId)];
    if (last !== undefined && state.round - last < BOT_TRADE_COOLDOWN_ROUNDS) continue;
    if (!tradableCells(state, partnerId).includes(missing[0])) continue;

    // Своя клетка, которая закроет партнёру его квартал.
    const swap = myTradable.find((i) => {
      const cell = BOARD[i];
      if (cell.kind !== 'district' || cell.group === group) return false;
      return groupCells(cell.group).every((j) => j === i || state.owners[j] === partnerId);
    });
    const base: Trade = {
      from: player.id,
      to: partnerId,
      give: { ...EMPTY_OFFER, cells: swap === undefined ? [] : [swap] },
      take: { ...EMPTY_OFFER, cells: [missing[0]] },
    };
    const mine = tradeGain(state, base, player.id);
    const theirs = tradeGain(state, base, partnerId);
    const money = Math.max(0, roundUpToStep((mine - theirs) / 2), roundUpToStep(AUCTION_STEP - theirs));
    if (mine - money <= 0 || player.money - money < BOT_CASH_RESERVE) continue;
    const trade: Trade = { ...base, give: { ...base.give, money } };
    if (canProposeTrade(state, trade)) return { type: 'PROPOSE_TRADE', trade };
  }
  return null;
}

/** В конце хода: сначала выкупить заложенное, потом строить — пока остаётся запас. */
function decideDevelopment(state: GameState): Action | null {
  const player = actingPlayer(state);
  const owned = ownedCells(state, player.id);
  const redeem = owned.find(
    (i) => canUnmortgage(state, i) && player.money - unmortgageCost(BOARD[i] as OwnableCell) >= BOT_BUILD_RESERVE,
  );
  if (redeem !== undefined) return { type: 'UNMORTGAGE', index: redeem };
  const build = owned.find((i) => canBuild(state, i) && player.money - buildCost(i) >= BOT_BUILD_RESERVE);
  if (build !== undefined) return { type: 'BUILD', index: build };
  return null;
}

/** Нехватка наличных: закладывает лишнее, затем продаёт постройки, в крайнем случае закладывает монополии. */
function decideInDebt(state: GameState): Action {
  const debt = state.debt!;
  const player = actingPlayer(state);
  if (player.money >= debt.amount) return { type: 'PAY_DEBT' };
  const owned = ownedCells(state, player.id);
  const inMonopoly = (i: number) => {
    const cell = BOARD[i];
    return cell.kind === 'district' && hasMonopoly(state, cell.group, player.id);
  };
  const loose = owned.find((i) => !inMonopoly(i) && canMortgage(state, i));
  if (loose !== undefined) return { type: 'MORTGAGE', index: loose };
  const sell = owned.find((i) => canSellBuilding(state, i));
  if (sell !== undefined) return { type: 'SELL_BUILDING', index: sell };
  const rest = owned.find((i) => canMortgage(state, i));
  if (rest !== undefined) return { type: 'MORTGAGE', index: rest };
  return { type: 'DECLARE_BANKRUPTCY' };
}
