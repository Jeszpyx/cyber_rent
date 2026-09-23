import { BAIL, BOARD, isOwnable } from './board';
import { currentPlayer } from './engine';
import type { Action, GameState, OwnableCell } from './types';

const BOT_CASH_RESERVE = 200;
/** Пока на поле столько свободных клеток, бот спешит выйти из Изолятора и скупать; позже выгоднее отсидеться. */
const BOT_LEAVE_ISOLATION_FREE_CELLS = 8;

export function decideBotAction(state: GameState): Action | null {
  switch (state.phase) {
    case 'roll':
      return { type: 'ROLL' };
    case 'isolation':
      return decideInIsolation(state);
    case 'buyDecision': {
      const player = currentPlayer(state);
      const cell = BOARD[player.position] as OwnableCell;
      return player.money - cell.price >= BOT_CASH_RESERVE ? { type: 'BUY' } : { type: 'SKIP_BUY' };
    }
    case 'card':
      return { type: 'APPLY_CARD' };
    case 'end':
      return { type: 'END_TURN' };
    case 'gameOver':
      return null;
  }
}

function decideInIsolation(state: GameState): Action {
  const player = currentPlayer(state);
  const freeCells = BOARD.filter((c) => isOwnable(c) && state.owners[c.index] === undefined).length;
  const early = freeCells >= BOT_LEAVE_ISOLATION_FREE_CELLS;
  // На последней попытке карточка лучше принудительного залога.
  const lastAttempt = player.isolation?.turnsLeft === 1;
  if (player.releaseCards.length > 0 && (early || lastAttempt)) return { type: 'USE_RELEASE_CARD' };
  if (early && player.money - BAIL >= BOT_CASH_RESERVE) return { type: 'PAY_BAIL' };
  return { type: 'ROLL' };
}
