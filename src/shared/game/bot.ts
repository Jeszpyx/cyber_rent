import { BAIL, BOARD, isOwnable } from './board';
import {
  actingPlayer,
  buildCost,
  canBuild,
  canMortgage,
  canSellBuilding,
  canUnmortgage,
  hasMonopoly,
  ownedCells,
  unmortgageCost,
} from './economy';
import type { Action, GameState, OwnableCell } from './types';

const BOT_CASH_RESERVE = 200;
/** Строит и выкупает залоги, только если после траты остаётся столько наличных. */
const BOT_BUILD_RESERVE = 300;
/** Пока на поле столько свободных клеток, бот спешит выйти из Изолятора и скупать; позже выгоднее отсидеться. */
const BOT_LEAVE_ISOLATION_FREE_CELLS = 8;

export function decideBotAction(state: GameState): Action | null {
  switch (state.phase) {
    case 'roll':
      return { type: 'ROLL' };
    case 'isolation':
      return decideInIsolation(state);
    case 'buyDecision': {
      const player = actingPlayer(state);
      const cell = BOARD[player.position] as OwnableCell;
      return player.money - cell.price >= BOT_CASH_RESERVE ? { type: 'BUY' } : { type: 'SKIP_BUY' };
    }
    case 'card':
      return { type: 'APPLY_CARD' };
    case 'debt':
      return decideInDebt(state);
    case 'end':
      return decideDevelopment(state) ?? { type: 'END_TURN' };
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
