import { BOARD, GROUP_COLORS } from '../../shared/game/board';
import { actingPlayer, minBid } from '../../shared/game/economy';
import type { Action, Auction, GameState, OwnableCell } from '../../shared/game/types';
import { TurnTimer } from './TurnTimer';

/** Быстрые надбавки к старшей ставке; первая кнопка — всегда минимальная ставка. */
const RAISES = [50, 100];

interface Props {
  state: GameState;
  auction: Auction;
  /** Только когда решает человек; без него — бот думает. */
  dispatch?: (action: Action) => void;
  deadline: number | null;
}

/** Торги за клетку: видны всем, кнопки — у человека, когда его очередь. */
export function AuctionModal({ state, auction, dispatch, deadline }: Props) {
  const cell = BOARD[auction.index] as OwnableCell;
  const color = cell.kind === 'district' ? GROUP_COLORS[cell.group] : 'var(--accent)';
  const actor = actingPlayer(state);
  const leader = state.players.find((p) => p.id === auction.leaderId);
  const min = minBid(auction);
  const bids = [min, ...RAISES.map((r) => auction.bid + r).filter((v) => v > min)];

  return (
    <div className="overlay">
      <div className="modal auction" style={{ borderColor: color }}>
        <div className="cell-card-head" style={{ background: color }}>
          <small>Торги · цена {cell.price}₵</small>
          <h2>{cell.name}</h2>
        </div>
        <p className="auction-bid">
          {leader ? (
            <>
              Ставка <b>{auction.bid}₵</b> — <span style={{ color: leader.color }}>{leader.name}</span>
            </>
          ) : (
            'Ставок пока нет'
          )}
        </p>
        <ul className="auction-queue">
          {auction.queue.map((id) => {
            const p = state.players.find((player) => player.id === id)!;
            const classes = [p.id === actor.id && 'turn', p.id === auction.leaderId && 'leader'].filter(Boolean).join(' ');
            return (
              <li key={id} className={classes} style={{ borderColor: p.color }}>
                {p.name} <small>{p.money}₵</small>
              </li>
            );
          })}
        </ul>
        {dispatch ? (
          <>
            <div className="actions">
              {bids.map((amount) => (
                <button
                  key={amount}
                  className={amount === min ? 'btn small primary' : 'btn small'}
                  disabled={amount > actor.money}
                  onClick={() => dispatch({ type: 'BID', amount })}
                >
                  {amount}₵
                </button>
              ))}
              <button className="btn small" onClick={() => dispatch({ type: 'PASS' })}>
                Пас
              </button>
            </div>
            <small className="auction-hint">
              Пас — выход из торгов насовсем. {deadline !== null && <TurnTimer key={deadline} deadline={deadline} />}
            </small>
          </>
        ) : (
          <span className="thinking">{actor.name} думает…</span>
        )}
      </div>
    </div>
  );
}
