import type { ReactNode } from 'react';
import { BOARD } from '../../shared/game/board';
import type { GameState } from '../../shared/game/types';
import { Cell } from './Cell';

/** Maps a cell index (0 = bottom-right corner, clockwise) to 1-based grid [row, column] on an 11×11 grid. */
function gridPosition(index: number): [number, number] {
  if (index <= 10) return [11, 11 - index];
  if (index <= 20) return [11 - (index - 10), 1];
  if (index <= 30) return [1, index - 19];
  return [index - 29, 11];
}

interface Props {
  state: GameState;
  onCellClick: (index: number) => void;
  children: ReactNode;
}

export function Board({ state, onCellClick, children }: Props) {
  return (
    <div className="board-wrap">
      <div className="board">
        {BOARD.map((cell) => {
          const [row, col] = gridPosition(cell.index);
          const owner = state.players.find((p) => p.id === state.owners[cell.index]);
          const tokens = state.players.filter((p) => !p.bankrupt && p.position === cell.index);
          return (
            <Cell
              key={cell.index}
              cell={cell}
              row={row}
              col={col}
              ownerColor={owner?.color}
              level={state.buildings[cell.index] ?? 0}
              mortgaged={Boolean(state.mortgaged[cell.index])}
              tokens={tokens}
              onClick={() => onCellClick(cell.index)}
            />
          );
        })}
        <div className="board-center">{children}</div>
      </div>
    </div>
  );
}
