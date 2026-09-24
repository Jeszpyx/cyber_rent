import { BOARD, GROUP_COLORS } from '../../shared/game/board';
import type { Action, GameState, PendingTrade, TradeOffer } from '../../shared/game/types';
import { TurnTimer } from './TurnTimer';

/** Список того, что переходит по обмену: клетки, деньги, карточки освобождения. */
export function OfferList({ state, offer }: { state: GameState; offer: TradeOffer }) {
  const empty = offer.cells.length === 0 && offer.money === 0 && offer.releaseCards.length === 0;
  return (
    <ul className="offer-list">
      {offer.cells.map((index) => {
        const cell = BOARD[index];
        return (
          <li key={index}>
            <span className="offer-dot" style={{ background: cell.kind === 'district' ? GROUP_COLORS[cell.group] : 'var(--accent)' }} />
            {cell.name}
            {state.mortgaged[index] && <small className="mortgaged-label"> · в залоге</small>}
          </li>
        );
      })}
      {offer.money > 0 && <li>💰 {offer.money}₵</li>}
      {offer.releaseCards.length > 0 && <li>🔓 Карточка освобождения ×{offer.releaseCards.length}</li>}
      {empty && <li className="muted">ничего</li>}
    </ul>
  );
}

interface Props {
  state: GameState;
  trade: PendingTrade;
  /** Только когда отвечает человек; без него — бот думает. */
  dispatch?: (action: Action) => void;
  deadline: number | null;
}

/** Предложение обмена, ждущее ответа адресата. */
export function TradeProposal({ state, trade, dispatch, deadline }: Props) {
  const from = state.players.find((p) => p.id === trade.from)!;
  const to = state.players.find((p) => p.id === trade.to)!;

  return (
    <div className="overlay">
      <div className="modal trade-modal">
        <h2>Обмен</h2>
        <p className="trade-parties">
          <b style={{ color: from.color }}>{from.name}</b> → <b style={{ color: to.color }}>{to.name}</b>
        </p>
        <div className="trade-side">
          <small>{dispatch ? 'Вы получаете' : `${from.name} отдаёт`}</small>
          <OfferList state={state} offer={trade.give} />
        </div>
        <div className="trade-side">
          <small>{dispatch ? 'Вы отдаёте' : `${from.name} просит`}</small>
          <OfferList state={state} offer={trade.take} />
        </div>
        {dispatch ? (
          <>
            <div className="actions">
              <button className="btn primary" onClick={() => dispatch({ type: 'ACCEPT_TRADE' })}>
                Принять
              </button>
              <button className="btn" onClick={() => dispatch({ type: 'REJECT_TRADE' })}>
                Отклонить
              </button>
            </div>
            {deadline !== null && <TurnTimer key={deadline} deadline={deadline} />}
          </>
        ) : (
          <span className="thinking">{to.name} обдумывает сделку…</span>
        )}
      </div>
    </div>
  );
}
