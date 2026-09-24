import {
  BANK_MODULES,
  BANK_TOWERS,
  BOARD,
  GROUP_BUILD_COST,
  MORTGAGE_INTEREST_PERCENT,
  MORTGAGE_RATE,
  TOWER_LEVEL,
  groupCells,
  isOwnable,
} from './board';
import { MODES, type GameMode } from './modes';
import type { DistrictGroup, GameState, OwnableCell, Phase, Player } from './types';

export function gameMode(state: GameState): GameMode {
  return MODES[state.mode];
}

/** Множитель ренты режима «Инфляция»: factor в степени числа пройденных порогов по кругам. */
export function rentMultiplier(state: GameState): number {
  const growth = gameMode(state).rentGrowth;
  if (!growth) return 1;
  return growth.factor ** Math.floor(state.round / growth.everyRounds);
}

/**
 * Капитал для победы по лимиту кругов: наличные, клетки по цене покупки
 * (заложенные — за вычетом полученного залога) и постройки по цене строительства.
 */
export function netWorth(state: GameState, player: Player): number {
  if (player.bankrupt) return 0;
  let total = player.money;
  for (const index of ownedCells(state, player.id)) {
    const cell = BOARD[index] as OwnableCell;
    total += cell.price - (state.mortgaged[index] ? mortgageValue(cell) : 0);
    total += buildingLevel(state, index) * buildCost(index);
  }
  return total;
}

/** Фазы своего хода, в которых можно строить, продавать, закладывать и выкупать. */
const MANAGE_PHASES: Phase[] = ['roll', 'isolation', 'end'];

/** Кто сейчас принимает решение: должник в фазе 'debt', иначе текущий игрок. */
export function actingPlayer(state: GameState): Player {
  if (state.debt) return state.players.find((p) => p.id === state.debt!.from)!;
  return state.players[state.currentPlayer];
}

export function buildingLevel(state: GameState, index: number): number {
  return state.buildings[index] ?? 0;
}

/** Цена одного уровня застройки клетки (модуль или небоскрёб). */
export function buildCost(index: number): number {
  const cell = BOARD[index];
  return cell.kind === 'district' ? GROUP_BUILD_COST[cell.group] : 0;
}

/** Банк выкупает постройки за половину цены. */
export function buildingSellValue(index: number): number {
  return Math.floor(buildCost(index) / 2);
}

export function mortgageValue(cell: OwnableCell): number {
  return Math.floor(cell.price * MORTGAGE_RATE);
}

export function unmortgageCost(cell: OwnableCell): number {
  const value = mortgageValue(cell);
  return value + Math.ceil((value * MORTGAGE_INTEREST_PERCENT) / 100);
}

/** Сколько модулей и небоскрёбов ещё осталось у банка. */
export function bankStock(state: GameState): { modules: number; towers: number } {
  let modules = BANK_MODULES;
  let towers = BANK_TOWERS;
  for (const level of Object.values(state.buildings)) {
    if (level >= TOWER_LEVEL) towers -= 1;
    else modules -= level;
  }
  return { modules, towers };
}

export function hasMonopoly(state: GameState, group: DistrictGroup, playerId: string): boolean {
  return groupCells(group).every((i) => state.owners[i] === playerId);
}

export function ownedCells(state: GameState, playerId: string): number[] {
  return BOARD.filter((c) => state.owners[c.index] === playerId).map((c) => c.index);
}

function groupLevels(state: GameState, group: DistrictGroup): number[] {
  return groupCells(group).map((i) => buildingLevel(state, i));
}

function ownedByActor(state: GameState, index: number): boolean {
  return state.owners[index] === actingPlayer(state).id;
}

/** Строить можно при монополии без заложенных клеток и равномерно: на клетке с минимальным уровнем квартала. */
export function canBuild(state: GameState, index: number): boolean {
  const cell = BOARD[index];
  if (!MANAGE_PHASES.includes(state.phase) || cell.kind !== 'district' || !ownedByActor(state, index)) return false;
  const player = actingPlayer(state);
  if (!hasMonopoly(state, cell.group, player.id)) return false;
  if (groupCells(cell.group).some((i) => state.mortgaged[i])) return false;
  const level = buildingLevel(state, index);
  if (level >= TOWER_LEVEL || level > Math.min(...groupLevels(state, cell.group))) return false;
  if (player.money < buildCost(index)) return false;
  const stock = bankStock(state);
  return level + 1 === TOWER_LEVEL ? stock.towers > 0 : stock.modules > 0;
}

/** Продавать равномерно: с клетки с максимальным уровнем квартала. Разрешено и должнику. */
export function canSellBuilding(state: GameState, index: number): boolean {
  const cell = BOARD[index];
  if (!MANAGE_PHASES.includes(state.phase) && state.phase !== 'debt') return false;
  if (cell.kind !== 'district' || !ownedByActor(state, index)) return false;
  const level = buildingLevel(state, index);
  return level > 0 && level === Math.max(...groupLevels(state, cell.group));
}

/**
 * Итог продажи одного уровня. Небоскрёб превращается обратно в 4 модуля, но если у банка
 * столько нет — остаётся столько, сколько есть, а недостающие модули выкупаются сразу.
 */
export function sellBuildingResult(state: GameState, index: number): { level: number; refund: number } {
  const level = buildingLevel(state, index);
  const next = level >= TOWER_LEVEL ? Math.min(TOWER_LEVEL - 1, bankStock(state).modules) : level - 1;
  return { level: next, refund: (level - next) * buildingSellValue(index) };
}

/** Заложить можно свою незаложенную клетку; район — только если в квартале нет построек. */
export function canMortgage(state: GameState, index: number): boolean {
  const cell = BOARD[index];
  if (!MANAGE_PHASES.includes(state.phase) && state.phase !== 'debt') return false;
  if (!isOwnable(cell) || !ownedByActor(state, index) || state.mortgaged[index]) return false;
  return cell.kind !== 'district' || groupLevels(state, cell.group).every((l) => l === 0);
}

export function canUnmortgage(state: GameState, index: number): boolean {
  const cell = BOARD[index];
  if (!MANAGE_PHASES.includes(state.phase) || !isOwnable(cell)) return false;
  if (!ownedByActor(state, index) || !state.mortgaged[index]) return false;
  return actingPlayer(state).money >= unmortgageCost(cell);
}

/** Наличные плюс всё, что можно выручить продажей построек и залогом. */
export function liquidationValue(state: GameState, player: Player): number {
  let total = player.money;
  for (const index of ownedCells(state, player.id)) {
    total += buildingLevel(state, index) * buildingSellValue(index);
    if (!state.mortgaged[index]) total += mortgageValue(BOARD[index] as OwnableCell);
  }
  return total;
}
