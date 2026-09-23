import {
  BAIL,
  BOARD,
  DOUBLES_TO_ISOLATION,
  ISOLATION_ATTEMPTS,
  ISOLATION_INDEX,
  START_MONEY,
  START_SALARY,
  TOWER_LEVEL,
  groupCells,
  isOwnable,
} from './board';
import { CARD_BY_ID, DECK_NAMES, deckCardIds } from './cards';
import { rollDie, shuffle } from './rng';
import type { Action, Card, CardDeck, GameState, OwnableCell, Player } from './types';

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
      pay(state, player, null, BAIL);
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
  } else {
    isolation.turnsLeft -= 1;
    if (isolation.turnsLeft > 0) {
      log(state, `Дубля нет — ${player.name} остаётся в Изоляторе. Попыток: ${isolation.turnsLeft}.`);
      finishMove(state);
      return;
    }
    log(state, `Попытки кончились: ${player.name} платит залог ${BAIL}₵.`);
    pay(state, player, null, BAIL);
    if (player.bankrupt) {
      finishMove(state);
      return;
    }
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
    } else if (ownerId !== player.id) {
      const rent = calculateRent(state, cell, diceSum(state));
      const owner = state.players.find((p) => p.id === ownerId)!;
      log(state, `${player.name} платит ренту ${rent}₵ игроку ${owner.name}.`);
      pay(state, player, owner, rent);
    }
  } else if (cell.kind === 'tax') {
    log(state, `${player.name} платит ${cell.amount}₵.`);
    pay(state, player, null, cell.amount);
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
      if (effect.amount >= 0) player.money += effect.amount;
      else pay(state, player, null, -effect.amount);
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
    case 'payEachPlayer':
      for (const other of opponents(state, player)) {
        if (player.bankrupt) break;
        pay(state, player, other, effect.amount);
      }
      break;
    case 'collectFromEachPlayer':
      for (const other of opponents(state, player)) pay(state, other, player, effect.amount);
      break;
    case 'getOutOfIsolation':
      player.releaseCards.push(card.id);
      log(state, `${player.name} сохраняет карточку освобождения.`);
      break;
    case 'repairs': {
      const cost = repairsCost(state, player, effect.perModule, effect.perTower);
      log(state, `${player.name} платит за ремонт ${cost}₵.`);
      if (cost > 0) pay(state, player, null, cost);
      break;
    }
  }
  finishMove(state);
}

export function calculateRent(state: GameState, cell: OwnableCell, diceSum: number): number {
  const ownerId = state.owners[cell.index];
  if (cell.kind === 'district') {
    const monopoly = groupCells(cell.group).every((i) => state.owners[i] === ownerId);
    return monopoly ? cell.rent * 2 : cell.rent;
  }
  const sameKindOwned = BOARD.filter(
    (c) => c.kind === cell.kind && state.owners[c.index] === ownerId,
  ).length;
  if (cell.kind === 'transit') return 25 * 2 ** (sameKindOwned - 1);
  return diceSum * (sameKindOwned >= 2 ? 10 : 4);
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

function pay(state: GameState, from: Player, to: Player | null, amount: number): void {
  const paid = Math.min(amount, from.money);
  from.money -= amount;
  if (to) to.money += paid;
  if (from.money < 0) bankrupt(state, from);
}

function bankrupt(state: GameState, player: Player): void {
  player.bankrupt = true;
  player.money = 0;
  for (const [index, ownerId] of Object.entries(state.owners)) {
    if (ownerId === player.id) delete state.owners[Number(index)];
  }
  for (const id of player.releaseCards) state.decks[CARD_BY_ID[id].deck].push(id);
  player.releaseCards = [];
  player.isolation = null;
  log(state, `${player.name} банкрот и выбывает из игры.`);

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
