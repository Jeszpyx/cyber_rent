import { useState } from 'react';
import { BAIL, BOARD, ISOLATION_ATTEMPTS } from '../../shared/game/board';
import { CARD_BY_ID } from '../../shared/game/cards';
import { currentPlayer, type NewGameOptions } from '../../shared/game/engine';
import type { OwnableCell } from '../../shared/game/types';
import { useGame } from '../hooks/useGame';
import { Board } from './Board';
import { BuildInfo } from './BuildInfo';
import { CellCard } from './CellCard';
import { Dice } from './Dice';
import { DrawnCard } from './DrawnCard';
import { PlayerPanel } from './PlayerPanel';

interface Props {
  options: NewGameOptions;
  onRestart: () => void;
}

export function Game({ options, onRestart }: Props) {
  const { state, dispatch } = useGame(options);
  const [selectedCell, setSelectedCell] = useState<number | null>(null);

  const player = currentPlayer(state);
  const humanTurn = !player.isBot && state.phase !== 'gameOver';
  const winner = state.players.find((p) => p.id === state.winnerId);
  const buyCell = state.phase === 'buyDecision' ? (BOARD[player.position] as OwnableCell) : null;
  const drawnCard = state.phase === 'card' && state.pendingCard ? CARD_BY_ID[state.pendingCard] : null;

  return (
    <div className="game">
      <Board state={state} onCellClick={setSelectedCell}>
        <div className="turn-label" style={{ color: player.color }}>
          {state.phase === 'gameOver' ? 'Игра окончена' : `Ход: ${player.name}`}
        </div>
        <Dice dice={state.dice} />
        <div className="actions">
          {humanTurn && state.phase === 'roll' && (
            <button className="btn primary" onClick={() => dispatch({ type: 'ROLL' })}>
              Бросить кубики
            </button>
          )}
          {humanTurn && state.phase === 'isolation' && player.isolation && (
            <>
              <button className="btn primary" onClick={() => dispatch({ type: 'ROLL' })}>
                Бросок на дубль {ISOLATION_ATTEMPTS - player.isolation.turnsLeft + 1}/{ISOLATION_ATTEMPTS}
              </button>
              <button
                className="btn"
                disabled={player.money < BAIL}
                onClick={() => dispatch({ type: 'PAY_BAIL' })}
              >
                Залог {BAIL}₵
              </button>
              {player.releaseCards.length > 0 && (
                <button className="btn" onClick={() => dispatch({ type: 'USE_RELEASE_CARD' })}>
                  🔓 Карточка
                </button>
              )}
            </>
          )}
          {humanTurn && buyCell && (
            <>
              <button className="btn primary" onClick={() => dispatch({ type: 'BUY' })}>
                Купить за {buyCell.price}₵
              </button>
              <button className="btn" onClick={() => dispatch({ type: 'SKIP_BUY' })}>
                Отказаться
              </button>
            </>
          )}
          {humanTurn && state.phase === 'end' && (
            <button className="btn primary" onClick={() => dispatch({ type: 'END_TURN' })}>
              Завершить ход
            </button>
          )}
          {!humanTurn && state.phase !== 'gameOver' && <span className="thinking">бот думает…</span>}
        </div>
        {buyCell && humanTurn && <div className="buy-hint">«{buyCell.name}» свободен</div>}
        {state.phase === 'isolation' && humanTurn && (
          <div className="buy-hint">Изолятор: дубль — свобода, после {ISOLATION_ATTEMPTS}-й неудачи — залог.</div>
        )}
      </Board>

      <aside className="side">
        <PlayerPanel state={state} />
        <ol className="log" reversed>
          {state.log
            .slice()
            .reverse()
            .map((entry) => (
              <li key={entry.id}>{entry.text}</li>
            ))}
        </ol>
        <div className="side-footer">
          <button className="btn small" onClick={onRestart}>
            Новая игра
          </button>
          <BuildInfo />
        </div>
      </aside>

      {selectedCell !== null && (
        <CellCard state={state} index={selectedCell} onClose={() => setSelectedCell(null)} />
      )}

      {drawnCard && (
        <DrawnCard
          card={drawnCard}
          player={player}
          onApply={humanTurn ? () => dispatch({ type: 'APPLY_CARD' }) : undefined}
        />
      )}

      {winner && (
        <div className="overlay">
          <div className="modal">
            <h2 style={{ color: winner.color }}>{winner.name} побеждает!</h2>
            <button className="btn primary" onClick={onRestart}>
              Новая игра
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
