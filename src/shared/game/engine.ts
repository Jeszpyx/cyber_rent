import {
  BAIL,
  BOARD,
  DOUBLES_TO_ISOLATION,
  ISOLATION_ATTEMPTS,
  ISOLATION_INDEX,
  START_MONEY,
  START_SALARY,
  TOWER_LEVEL,
  TRANSIT_RENT,
  UTILITY_MULTIPLIERS,
  isOwnable,
} from './board';
import { CARD_BY_ID, DECK_NAMES, deckCardIds } from './cards';
import {
  actingPlayer,
  buildCost,
  buildingLevel,
  buildingSellValue,
  canBuild,
  canMortgage,
  canSellBuilding,
  canUnmortgage,
  hasMonopoly,
  liquidationValue,
  mortgageValue,
  sellBuildingResult,
  unmortgageCost,
} from './economy';
import { rollDie, shuffle } from './rng';
import type { Action, Card, CardDeck, Debt, GameState, OwnableCell, Payment, Player } from './types';

export { actingPlayer } from './economy';

const LOG_LIMIT = 60;
const PLAYER_COLORS = ['#3ee6ff', '#ff2e9a', '#ffe14d', '#2eff8c'];
const BOT_NAMES = ['Бот Глитч', 'Бот Неон', 'Бот Хэш'];

export interface NewGameOptions {
  playerName: string;
  bots: number;
  seed?: number;
}

export function createGame({ playerName, bots, seed }: NewGameOptions): GameState {
  const players: Player[] = [
    { id: 'p0', name: playerName, isBot: false, color: PLAYER_COLORS[0], money: START_MONEY, position: 0, bankrupt: false, releaseCards: [], isolation: null },
  ];
  for (let i = 0; i < bots; i++) {
    players.push({
      id: `p${i + 1}`,
      name: BOT_NAMES[i],
      isBot: true,
      color: PLAYER_COLORS[i + 1],
      money: START_MONEY,
      position: 0,
      bankrupt: false,
      releaseCards: [],
      isolation: null,
    });
  }
  const [hack, s1] = shuffle(deckCardIds('hack'), seed ?? Math.floor(Math.random() * 2 ** 31));
  const [net, s2] = shuffle(deckCardIds('net'), s1);
  const state: GameState = {
    players,
    currentPlayer: 0,
    phase: 'roll',
    dice: null,
    rolledDouble: false,
    doublesInRow: 0,
    owners: {},
    buildings: {},
    mortgaged: {},
    debt: null,
    decks: { hack, net },
    pendingCard: null,
    seed: s2,
    log: [],
    logCounter: 0,
    winnerId: null,
  };
  log(state, `Игра началась. Первым ходит ${players[0].name}.`);
  return state;
}

export function currentPlayer(state: GameState): Player {
  return state.players[state.currentPlayer];
}

export function applyAction(prev: GameState, action: Action): GameState {
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
      log(state, `${player.name} покупает «${cell.name}» за ${cell.price}₵.`);
      finishMove(state);
      return state;
    }
    case 'SKIP_BUY': {
      if (prev.phase !== 'buyDecision') return prev;
      const state = structuredClone(prev);
      const player = currentPlayer(state);
      log(state, `${player.name} отказывается от покупки «${BOARD[player.position].name}».`);
      finishMove(state);
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
      log(state, `${player.name} платит залог ${BAIL}₵ и выходит из Изолятора.`);
      transfer(player, null, BAIL);
      release(state, player);
      return state;
    }
    case 'USE_RELEASE_CARD': {
      if (prev.phase !== 'isolation' || currentPlayer(prev).releaseCards.length === 0) return prev;
      const state = structuredClone(prev);
      const player = currentPlayer(state);
      const id = player.releaseCards.shift()!;
      state.decks[CARD_BY_ID[id].deck].push(id);
      log(state, `${player.name} использует карточку освобождения и выходит из Изолятора.`);
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
      const what = level === TOWER_LEVEL ? 'небоскрёб' : `модуль ${level}`;
      log(state, `${player.name} строит ${what} в «${BOARD[action.index].name}» за ${cost}₵.`);
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
      log(state, `${player.name} продаёт постройку в «${BOARD[action.index].name}» банку за ${refund}₵.`);
      return state;
    }
    case 'MORTGAGE': {
      if (!canMortgage(prev, action.index)) return prev;
      const state = structuredClone(prev);
      const player = actingPlayer(state);
      const cell = BOARD[action.index] as OwnableCell;
      player.money += mortgageValue(cell);
      state.mortgaged[cell.index] = true;
      log(state, `${player.name} закладывает «${cell.name}» и получает ${mortgageValue(cell)}₵.`);
      return state;
    }
    case 'UNMORTGAGE': {
      if (!canUnmortgage(prev, action.index)) return prev;
      const state = structuredClone(prev);
      const player = actingPlayer(state);
      const cell = BOARD[action.index] as OwnableCell;
      player.money -= unmortgageCost(cell);
      delete state.mortgaged[cell.index];
      log(state, `${player.name} выкупает «${cell.name}» из залога за ${unmortgageCost(cell)}₵.`);
      return state;
    }
    case 'PAY_DEBT': {
      if (prev.phase !== 'debt' || !prev.debt || actingPlayer(prev).money < prev.debt.amount) return prev;
      const state = structuredClone(prev);
      const debt = state.debt!;
      state.debt = null;
      const from = playerById(state, debt.from);
      const to = debt.to === null ? null : playerById(state, debt.to);
      transfer(from, to, debt.amount);
      log(state, `${from.name} расплачивается: ${debt.amount}₵ ${to ? `игроку ${to.name}` : 'банку'}.`);
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
  }
}

/** Moves the current player by the given dice and resolves the landing cell. Mutates state. */
export function resolveRoll(state: GameState, dice: [number, number]): void {
  const player = currentPlayer(state);
  const [d1, d2] = dice;
  state.dice = dice;
  state.rolledDouble = d1 === d2;
  log(state, `${player.name} бросает ${d1} и ${d2}${state.rolledDouble ? ' — дубль!' : '.'}`);
  if (player.isolation) {
    rollInIsolation(state, player);
    return;
  }
  if (state.rolledDouble) {
    state.doublesInRow += 1;
    if (state.doublesInRow >= DOUBLES_TO_ISOLATION) {
      log(state, `${DOUBLES_TO_ISOLATION} дубля подряд — дроны безопасности засекли ${player.name}.`);
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
    log(state, `${player.name} выбрасывает дубль и выходит из Изолятора.`);
    leaveIsolationAndMove(state);
    return;
  }
  isolation.turnsLeft -= 1;
  if (isolation.turnsLeft > 0) {
    log(state, `Дубля нет — ${player.name} остаётся в Изоляторе. Попыток: ${isolation.turnsLeft}.`);
    finishMove(state);
    return;
  }
  log(state, `Попытки кончились: ${player.name} платит залог ${BAIL}₵.`);
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
  log(state, `${player.name} попадает на «${cell.name}».`);

  if (isOwnable(cell)) {
    const ownerId = state.owners[cell.index];
    if (ownerId === undefined) {
      if (player.money >= cell.price) {
        state.phase = 'buyDecision';
        return;
      }
      log(state, `У ${player.name} не хватает денег на покупку.`);
    } else if (ownerId !== player.id && state.mortgaged[cell.index]) {
      log(state, `«${cell.name}» в залоге — рента не берётся.`);
    } else if (ownerId !== player.id) {
      const rent = calculateRent(state, cell, diceSum(state));
      const owner = playerById(state, ownerId);
      log(state, `${player.name} платит ренту ${rent}₵ игроку ${owner.name}.`);
      settle(state, [{ from: player.id, to: owner.id, amount: rent }], 'finish');
      return;
    }
  } else if (cell.kind === 'tax') {
    log(state, `${player.name} платит ${cell.amount}₵.`);
    settle(state, [{ from: player.id, to: null, amount: cell.amount }], 'finish');
    return;
  } else if (cell.kind === 'goToIsolation') {
    sendToIsolation(state, player);
  } else if (cell.kind === 'hack' || cell.kind === 'net') {
    drawCard(state, cell.kind);
    return;
  }

  finishMove(state);
}

function drawCard(state: GameState, deck: CardDeck): void {
  const player = currentPlayer(state);
  const id = state.decks[deck].shift();
  if (id === undefined) {
    log(state, `Колода «${DECK_NAMES[deck]}» пуста.`);
    finishMove(state);
    return;
  }
  const card = CARD_BY_ID[id];
  // Карточка освобождения остаётся у игрока и вернётся в колоду после использования.
  if (card.effect.type !== 'getOutOfIsolation') state.decks[deck].push(id);
  state.pendingCard = id;
  state.phase = 'card';
  log(state, `${player.name} тянет «${DECK_NAMES[deck]}»: ${card.text}`);
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
      log(state, `${player.name} сохраняет карточку освобождения.`);
      break;
    case 'repairs': {
      const cost = repairsCost(state, player, effect.perModule, effect.perTower);
      log(state, `${player.name} платит за ремонт ${cost}₵.`);
      settle(state, [{ from: player.id, to: null, amount: cost }], 'finish');
      return;
    }
  }
  finishMove(state);
}

/** Заложенная клетка ренты не приносит. Монополия без построек удваивает базовую ренту района. */
export function calculateRent(state: GameState, cell: OwnableCell, diceSum: number): number {
  const ownerId = state.owners[cell.index];
  if (ownerId === undefined || state.mortgaged[cell.index]) return 0;
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
  player.position = ((target % BOARD.length) + BOARD.length) % BOARD.length;
}

function paySalary(state: GameState, player: Player): void {
  player.money += START_SALARY;
  log(state, `${player.name} проходит Старт и получает ${START_SALARY}₵.`);
}

function sendToIsolation(state: GameState, player: Player): void {
  player.position = ISOLATION_INDEX;
  player.isolation = { turnsLeft: ISOLATION_ATTEMPTS };
  state.rolledDouble = false;
  state.doublesInRow = 0;
  log(state, `${player.name} отправляется в Изолятор.`);
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

function transfer(from: Player, to: Player | null, amount: number): void {
  from.money -= amount;
  if (to) to.money += amount;
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
      transfer(from, to, payment.amount);
    } else if (liquidationValue(state, from) >= payment.amount) {
      state.debt = { ...payment, queue: payments.slice(i + 1), then };
      state.phase = 'debt';
      const whom = to ? `игроку ${to.name}` : 'банку';
      log(state, `${from.name} должен ${payment.amount}₵ ${whom}: не хватает наличных, нужно продать постройки или заложить собственность.`);
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
  log(
    state,
    creditor
      ? `${player.name} банкрот и выбывает из игры. Всё имущество переходит игроку ${creditor.name}.`
      : `${player.name} банкрот и выбывает из игры. Имущество возвращается банку.`,
  );

  const alive = state.players.filter((p) => !p.bankrupt);
  if (alive.length === 1) {
    state.phase = 'gameOver';
    state.winnerId = alive[0].id;
    log(state, `${alive[0].name} побеждает!`);
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
  const player = state.players[next];
  state.currentPlayer = next;
  state.phase = player.isolation ? 'isolation' : 'roll';
  state.dice = null;
  state.rolledDouble = false;
  state.doublesInRow = 0;
  log(state, `Ход игрока ${player.name}${player.isolation ? ' (в Изоляторе)' : ''}.`);
}

function log(state: GameState, text: string): void {
  state.logCounter += 1;
  state.log.push({ id: state.logCounter, text });
  if (state.log.length > LOG_LIMIT) state.log.splice(0, state.log.length - LOG_LIMIT);
}
