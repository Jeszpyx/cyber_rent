import { useState } from 'react';
import { BAIL, BOARD, ISOLATION_ATTEMPTS } from '../../shared/game/board';
import { CARD_BY_ID } from '../../shared/game/cards';
import { canBuild, gameMode, ownedCells, rentMultiplier } from '../../shared/game/economy';
import { actingPlayer, currentPlayer, standings, type NewGameOptions } from '../../shared/game/engine';
import type { OwnableCell } from '../../shared/game/types';
import { useGame } from '../hooks/useGame';
import { AuctionModal } from './AuctionModal';
import { Board } from './Board';
import { BuildInfo } from './BuildInfo';
import { CellCard } from './CellCard';
import { Dice } from './Dice';
import { DrawnCard } from './DrawnCard';
import { PlayerPanel } from './PlayerPanel';
import { TradeDialog } from './TradeDialog';
import { TradeProposal } from './TradeProposal';
import { TurnTimer } from './TurnTimer';

interface Props {
  options: NewGameOptions;
  onRestart: () => void;
}

export function Game({ options, onRestart }: Props) {
  const { state, dispatch, deadline } = useGame(options);
  const [selectedCell, setSelectedCell] = useState<number | null>(null);
  const [tradeOpen, setTradeOpen] = useState(false);

  const player = currentPlayer(state);
  // Решает должник в фазе 'debt', иначе — тот, чей ход.
  const actor = actingPlayer(state);
  const humanTurn = !actor.isBot && state.phase !== 'gameOver';
  const debt = state.phase === 'debt' ? state.debt : null;
  const creditor = debt?.to ? state.players.find((p) => p.id === debt.to) : null;
  const canDevelop = humanTurn && ownedCells(state, actor.id).some((i) => canBuild(state, i));
  // Обмен предлагают в свой ход там же, где строят: до броска, в Изоляторе и в конце хода.
  const canTrade = humanTurn && (state.phase === 'roll' || state.phase === 'isolation' || state.phase === 'end');
  const winner = state.players.find((p) => p.id === state.winnerId);
  const buyCell = state.phase === 'buyDecision' ? (BOARD[player.position] as OwnableCell) : null;
  const mode = gameMode(state);
  const multiplier = rentMultiplier(state);
  // Победа по лимиту кругов: к концу партии в игре осталось больше одного игрока.
  const finalStandings = winner && state.players.filter((p) => !p.bankrupt).length > 1 ? standings(state) : null;
  const drawnCard =state.phase === 'card' && state.pendingCard ? CARD_BY_ID[state.pendingCard] : null;

  return (
    <div className="game">
      <Board state={state} onCellClick={setSelectedCell}>
        <div className="turn-label" style={{ color: player.color }}>
          {state.phase === 'gameOver' ? 'Игра окончена' : `Ход: ${player.name}`}
        </div>
        <div className="game-status">
          <span title={mode.description}>{mode.name}</span>
          <span>
            Круг {state.round}
            {mode.roundLimit !== null && `/${mode.roundLimit}`}
          </span>
          <span title="Копилка Нейтральной зоны: налоги и штрафы, забирает попавший на клетку">☯ {state.pot}₵</span>
          {multiplier > 1 && <span className="inflation">рента ×{multiplier}</span>}
          {humanTurn && deadline !== null && <TurnTimer key={deadline} deadline={deadline} />}
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
              <button className="btn" onClick={() => dispatch({ type: 'START_AUCTION' })}>
                На торги
              </button>
            </>
          )}
          {humanTurn && state.phase === 'end' && (
            <button className="btn primary" onClick={() => dispatch({ type: 'END_TURN' })}>
              Завершить ход
            </button>
          )}
          {humanTurn && debt && (
            <>
              <button
                className="btn primary"
                disabled={actor.money < debt.amount}
                onClick={() => dispatch({ type: 'PAY_DEBT' })}
              >
                Заплатить {debt.amount}₵
              </button>
              <button className="btn" onClick={() => dispatch({ type: 'DECLARE_BANKRUPTCY' })}>
                Сдаться
              </button>
            </>
          )}
          {canTrade && (
            <button className="btn" onClick={() => setTradeOpen(true)}>
              ⇄ Обмен
            </button>
          )}
          {!humanTurn && state.phase !== 'gameOver' && <span className="thinking">бот думает…</span>}
        </div>
        {buyCell && humanTurn && <div className="buy-hint">«{buyCell.name}» свободен. Откажетесь — клетка уйдёт на торги.</div>}
        {state.phase === 'isolation' && humanTurn && (
          <div className="buy-hint">Изолятор: дубль — свобода, после {ISOLATION_ATTEMPTS}-й неудачи — залог.</div>
        )}
        {debt && humanTurn && (
          <div className="buy-hint debt-hint">
            Долг {debt.amount}₵ {creditor ? `игроку ${creditor.name}` : 'банку'}, наличных {actor.money}₵. Нажмите на свою
            клетку, чтобы продать постройки или заложить её.
          </div>
        )}
        {canDevelop && <div className="buy-hint">Квартал ваш целиком — нажмите на район, чтобы строить.</div>}
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
        <CellCard
          state={state}
          index={selectedCell}
          managerId={humanTurn ? actor.id : null}
          dispatch={dispatch}
          onClose={() => setSelectedCell(null)}
        />
      )}

      {state.auction && (
        <AuctionModal
          state={state}
          auction={state.auction}
          dispatch={humanTurn ? dispatch : undefined}
          deadline={humanTurn ? deadline : null}
        />
      )}

      {state.trade && (
        <TradeProposal
          state={state}
          trade={state.trade}
          dispatch={humanTurn ? dispatch : undefined}
          deadline={humanTurn ? deadline : null}
        />
      )}

      {tradeOpen && canTrade && (
        <TradeDialog
          state={state}
          player={actor}
          onPropose={(trade) => {
            dispatch({ type: 'PROPOSE_TRADE', trade });
            setTradeOpen(false);
          }}
          onClose={() => setTradeOpen(false)}
        />
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
            {finalStandings && (
              <>
                <p className="standings-title">Лимит кругов исчерпан. Капитал:</p>
                <ol className="standings">
                  {finalStandings.map(({ player: p, worth }) => (
                    <li key={p.id}>
                      <span style={{ color: p.color }}>{p.name}</span>
                      <b>{worth}₵</b>
                    </li>
                  ))}
                </ol>
              </>
            )}
            <button className="btn primary" onClick={onRestart}>
              Новая игра
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
