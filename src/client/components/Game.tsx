import { useState, useSyncExternalStore } from 'react';
import { BAIL, BOARD, ISOLATION_ATTEMPTS } from '../../shared/game/board';
import { CARD_BY_ID } from '../../shared/game/cards';
import { canBuild, gameMode, ownedCells, rentMultiplier } from '../../shared/game/economy';
import { actingPlayer, currentPlayer } from '../../shared/game/engine';
import type { Action, GameState, OwnableCell, Player } from '../../shared/game/types';
import { setSoundEnabled, soundEnabled, subscribeSound } from '../feedback';
import { useGame, type GameInit, type GameSession } from '../hooks/useGame';
import { useBackButton, useMainButton, type MainButtonConfig } from '../hooks/useTelegramButtons';
import { AuctionModal } from './AuctionModal';
import { Board } from './Board';
import { BuildInfo } from './BuildInfo';
import { CellCard } from './CellCard';
import { Dice } from './Dice';
import { DrawnCard } from './DrawnCard';
import { GameSummary } from './GameSummary';
import { LogPanel } from './LogPanel';
import { PlayerPanel } from './PlayerPanel';
import { TradeDialog } from './TradeDialog';
import { TradeProposal } from './TradeProposal';
import { TurnTimer } from './TurnTimer';

/**
 * Главное действие хода человека — его дублирует нижняя кнопка Telegram (MainButton).
 * Торги и ответ на обмен туда не выносятся: там несколько равноправных вариантов.
 */
function mainAction(state: GameState, actor: Player): (Omit<MainButtonConfig, 'onClick'> & { action: Action }) | null {
  switch (state.phase) {
    case 'roll':
      return { text: 'Бросить кубики', action: { type: 'ROLL' } };
    case 'isolation':
      return { text: 'Бросок на дубль', action: { type: 'ROLL' } };
    case 'buyDecision':
      return { text: `Купить за ${(BOARD[actor.position] as OwnableCell).price}₵`, action: { type: 'BUY' } };
    case 'card':
      return { text: 'ОК', action: { type: 'APPLY_CARD' } };
    case 'debt':
      return { text: `Заплатить ${state.debt!.amount}₵`, action: { type: 'PAY_DEBT' }, disabled: actor.money < state.debt!.amount };
    case 'end':
      return { text: 'Завершить ход', action: { type: 'END_TURN' } };
    default:
      return null;
  }
}

interface Props {
  init: GameInit;
  /** выйти в меню; идущая партия остаётся в сохранении */
  onExit: () => void;
}

/** Партия против ботов на этом устройстве. */
export function Game({ init, onExit }: Props) {
  return <GameScreen session={useGame(init)} onExit={onExit} exitTitle="Партия сохранится — её можно продолжить из меню" />;
}

interface ScreenProps {
  session: GameSession;
  onExit: () => void;
  /** подсказка к кнопке «В меню» */
  exitTitle: string;
  /** онлайн-комната: код показывается в строке статуса, своя фишка помечается в списке игроков */
  roomCode?: string;
  /** короткое сообщение поверх экрана: отклонённое действие, потеря связи */
  notice?: string | null;
}

/** Экран партии: одинаковый для игры с ботами и онлайн-комнаты, отличается только сессия. */
export function GameScreen({ session, onExit, exitTitle, roomCode, notice }: ScreenProps) {
  const { state, dispatch, deadline, animation, localId } = session;
  const [selectedCell, setSelectedCell] = useState<number | null>(null);
  const [tradeOpen, setTradeOpen] = useState(false);
  const [summaryClosed, setSummaryClosed] = useState(false);
  const sound = useSyncExternalStore(subscribeSound, soundEnabled);

  const player = currentPlayer(state);
  // Решает должник в фазе 'debt', иначе — тот, чей ход.
  const actor = actingPlayer(state);
  // Решения показываем только тому, чья фишка решает, и только когда она дошла.
  const humanTurn = actor.id === localId && !actor.isBot && state.phase !== 'gameOver' && !animation.busy;
  const waiting = actor.id !== localId || actor.isBot;
  const me = state.players.find((p) => p.id === localId);
  // После таймаутов фишкой управляет бот — игрок может вернуть управление.
  const takenOver = me && me.isBot && !me.bankrupt && state.phase !== 'gameOver';
  const debt = state.phase === 'debt' ? state.debt : null;
  const creditor = debt?.to ? state.players.find((p) => p.id === debt.to) : null;
  const canDevelop = humanTurn && ownedCells(state, actor.id).some((i) => canBuild(state, i));
  // Обмен предлагают в свой ход там же, где строят: до броска, в Изоляторе и в конце хода.
  const canTrade = humanTurn && (state.phase === 'roll' || state.phase === 'isolation' || state.phase === 'end');
  const buyCell = state.phase === 'buyDecision' ? (BOARD[player.position] as OwnableCell) : null;
  const mode = gameMode(state);
  const multiplier = rentMultiplier(state);
  const drawnCard = state.phase === 'card' && state.pendingCard && !animation.busy ? CARD_BY_ID[state.pendingCard] : null;
  const finished = state.phase === 'gameOver' && !animation.busy;
  const showSummary = finished && !summaryClosed;

  // Кнопки Telegram: «назад» закрывает модалки, которые можно закрыть; главная дублирует действие хода.
  const closeModal = tradeOpen && canTrade
    ? () => setTradeOpen(false)
    : selectedCell !== null
      ? () => setSelectedCell(null)
      : showSummary
        ? () => setSummaryClosed(true)
        : null;
  const main = humanTurn && !closeModal ? mainAction(state, actor) : null;
  useBackButton(closeModal);
  useMainButton(
    main
      ? { text: main.text, disabled: main.disabled, onClick: () => dispatch(main.action) }
      : showSummary
        ? { text: 'Новая игра', onClick: onExit }
        : finished && !closeModal
          ? { text: 'Итоги партии', onClick: () => setSummaryClosed(false) }
          : null,
  );

  return (
    <div className="game">
      <Board state={state} shown={animation.shown} onCellClick={setSelectedCell}>
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
          {roomCode && <span title="Код онлайн-комнаты">⌘ {roomCode}</span>}
          {humanTurn && deadline !== null && <TurnTimer key={deadline} deadline={deadline} />}
        </div>
        <Dice dice={state.dice} rolling={animation.rolling} />
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
          {waiting && state.phase !== 'gameOver' && !animation.busy && (
            <span className="thinking">{actor.isBot ? 'бот думает…' : `решает ${actor.name}…`}</span>
          )}
          {takenOver && (
            <button className="btn" onClick={() => dispatch({ type: 'TAKE_CONTROL', playerId: me.id })}>
              Вернуть управление
            </button>
          )}
          {finished && summaryClosed && (
            <button className="btn primary" onClick={() => setSummaryClosed(false)}>
              Итоги партии
            </button>
          )}
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
        {takenOver && <div className="buy-hint">Вы долго молчали, и за вас играет бот.</div>}
      </Board>

      <aside className="side">
        <PlayerPanel state={state} you={roomCode ? localId : null} />
        <LogPanel state={state} />
        <div className="side-footer">
          <button className="btn small" onClick={onExit} title={exitTitle}>
            В меню
          </button>
          <button
            className="btn small"
            onClick={() => setSoundEnabled(!sound)}
            aria-pressed={sound}
            title={sound ? 'Выключить звук и вибрацию' : 'Включить звук и вибрацию'}
          >
            {sound ? '🔊' : '🔇'}
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

      {state.auction && !animation.busy && (
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

      {showSummary && <GameSummary state={state} onNewGame={onExit} onClose={() => setSummaryClosed(true)} />}

      {notice && (
        <div className="toast" role="status">
          {notice}
        </div>
      )}
    </div>
  );
}
