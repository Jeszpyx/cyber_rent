import { BOARD } from './board';
import { currentPlayer } from './engine';
import type { Action, GameState, OwnableCell } from './types';

const BOT_CASH_RESERVE = 200;

export function decideBotAction(state: GameState): Action | null {
  switch (state.phase) {
    case 'roll':
      return { type: 'ROLL' };
    case 'buyDecision': {
      const player = currentPlayer(state);
      const cell = BOARD[player.position] as OwnableCell;
      return player.money - cell.price >= BOT_CASH_RESERVE ? { type: 'BUY' } : { type: 'SKIP_BUY' };
    }
    case 'end':
      return { type: 'END_TURN' };
    case 'gameOver':
      return null;
  }
}
