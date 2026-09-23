import { BOARD, ISOLATION_INDEX, START_MONEY, START_SALARY, groupCells, isOwnable } from './board';
import { rollDie } from './rng';
import type { Action, GameState, OwnableCell, Player } from './types';

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
    { id: 'p0', name: playerName, isBot: false, color: PLAYER_COLORS[0], money: START_MONEY, position: 0, bankrupt: false },
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
    });
  }
  const state: GameState = {
    players,
    currentPlayer: 0,
    phase: 'roll',
    dice: null,
    rolledDouble: false,
    owners: {},
    seed: seed ?? Math.floor(Math.random() * 2 ** 31),
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
      if (prev.phase !== 'roll') return prev;
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

  const target = player.position + d1 + d2;
  if (target >= BOARD.length) {
    player.money += START_SALARY;
    log(state, `${player.name} проходит Старт и получает ${START_SALARY}₵.`);
  }
  player.position = target % BOARD.length;

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
      const rent = calculateRent(state, cell, d1 + d2);
      const owner = state.players.find((p) => p.id === ownerId)!;
      log(state, `${player.name} платит ренту ${rent}₵ игроку ${owner.name}.`);
      pay(state, player, owner, rent);
    }
  } else if (cell.kind === 'tax') {
    log(state, `${player.name} платит ${cell.amount}₵.`);
    pay(state, player, null, cell.amount);
  } else if (cell.kind === 'goToIsolation') {
    player.position = ISOLATION_INDEX;
    state.rolledDouble = false;
    log(state, `${player.name} отправляется в Изолятор.`);
  } else if (cell.kind === 'hack' || cell.kind === 'net') {
    log(state, `Карточки «${cell.name}» пока в разработке — ничего не происходит.`);
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
  state.currentPlayer = next;
  state.phase = 'roll';
  state.dice = null;
  state.rolledDouble = false;
  log(state, `Ход игрока ${state.players[next].name}.`);
}

function log(state: GameState, text: string): void {
  state.logCounter += 1;
  state.log.push({ id: state.logCounter, text });
  if (state.log.length > LOG_LIMIT) state.log.splice(0, state.log.length - LOG_LIMIT);
}
