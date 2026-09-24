import type { CSSProperties, ReactNode } from 'react';
import { BOARD } from '../../shared/game/board';
import type { GameState } from '../../shared/game/types';
import { gridPosition, useBoardLayout } from '../hooks/useBoardLayout';
import { Cell } from './Cell';

interface Props {
  state: GameState;
  /** player id → клетка, где фишку показать вместо state.position (идёт анимация хода) */
  shown: Record<string, number>;
  onCellClick: (index: number) => void;
  children: ReactNode;
}

export function Board({ state, shown, onCellClick, children }: Props) {
  const layout = useBoardLayout();
  const current = state.players[state.currentPlayer];
  const activeCell = state.phase === 'gameOver' ? null : (shown[current.id] ?? current.position);
  return (
    <div className="board-wrap">
      <div
        className={`board ${layout.orientation}`}
        style={{ '--cols': layout.cols - 2, '--rows': layout.rows - 2 } as CSSProperties}
      >
        {BOARD.map((cell) => {
          const [row, col, side] = gridPosition(cell.index, layout);
          const owner = state.players.find((p) => p.id === state.owners[cell.index]);
          const tokens = state.players.filter((p) => !p.bankrupt && (shown[p.id] ?? p.position) === cell.index);
          return (
            <Cell
              key={cell.index}
              cell={cell}
              row={row}
              col={col}
              side={side}
              ownerColor={owner?.color}
              activeColor={cell.index === activeCell ? current.color : undefined}
              level={state.buildings[cell.index] ?? 0}
              mortgaged={Boolean(state.mortgaged[cell.index])}
              note={cell.kind === 'neutral' ? `${state.pot}₵` : undefined}
              tokens={tokens}
              moving={tokens.filter((p) => p.id in shown).map((p) => p.id)}
              onClick={() => onCellClick(cell.index)}
            />
          );
        })}
        <div className="board-center">
          <div className="center-inner">{children}</div>
        </div>
      </div>
    </div>
  );
}
