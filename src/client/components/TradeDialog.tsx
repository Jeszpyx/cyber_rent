import { useState } from 'react';
import { BOARD, GROUP_COLORS } from '../../shared/game/board';
import { EMPTY_OFFER, canProposeTrade, tradableCells, tradeKey } from '../../shared/game/economy';
import type { GameState, Player, Trade, TradeOffer } from '../../shared/game/types';

interface EditorProps {
  state: GameState;
  player: Player;
  title: string;
  offer: TradeOffer;
  onChange: (offer: TradeOffer) => void;
}

const toggle = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

/** Что одна сторона кладёт в сделку: свои передаваемые клетки, деньги и карточки освобождения. */
function OfferEditor({ state, player, title, offer, onChange }: EditorProps) {
  const cells = tradableCells(state, player.id);
  return (
    <fieldset className="trade-side">
      <legend>{title}</legend>
      {cells.length === 0 && <small className="muted">Нет клеток для обмена</small>}
      {cells.map((index) => {
        const cell = BOARD[index];
        return (
          <label key={index} className="trade-item">
            <input
              type="checkbox"
              checked={offer.cells.includes(index)}
              onChange={() => onChange({ ...offer, cells: toggle(offer.cells, index) })}
            />
            <span className="offer-dot" style={{ background: cell.kind === 'district' ? GROUP_COLORS[cell.group] : 'var(--accent)' }} />
            <span className="trade-item-name">{cell.name}</span>
            {state.mortgaged[index] && <small className="mortgaged-label">залог</small>}
          </label>
        );
      })}
      {player.releaseCards.map((id) => (
        <label key={id} className="trade-item">
          <input
            type="checkbox"
            checked={offer.releaseCards.includes(id)}
            onChange={() => onChange({ ...offer, releaseCards: toggle(offer.releaseCards, id) })}
          />
          <span className="trade-item-name">🔓 Карточка освобождения</span>
        </label>
      ))}
      <label className="trade-money">
        ₵
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={player.money}
          step={10}
          value={offer.money === 0 ? '' : offer.money}
          placeholder="0"
          onChange={(e) => onChange({ ...offer, money: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
        />
        <small>из {player.money}₵</small>
      </label>
    </fieldset>
  );
}

interface Props {
  state: GameState;
  player: Player;
  onPropose: (trade: Trade) => void;
  onClose: () => void;
}

/** Составление предложения обмена человеком в свой ход. */
export function TradeDialog({ state, player, onPropose, onClose }: Props) {
  const partners = state.players.filter((p) => p.id !== player.id && !p.bankrupt);
  const alreadyAsked = (id: string) => state.tradeRounds[tradeKey(player.id, id)] === state.round;
  const [partnerId, setPartnerId] = useState(() => partners.find((p) => !alreadyAsked(p.id))?.id ?? '');
  const [give, setGive] = useState<TradeOffer>(EMPTY_OFFER);
  const [take, setTake] = useState<TradeOffer>(EMPTY_OFFER);
  const partner = partners.find((p) => p.id === partnerId);
  const trade: Trade = { from: player.id, to: partnerId, give, take };

  const choose = (id: string) => {
    setPartnerId(id);
    setTake(EMPTY_OFFER);
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal trade-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Предложить обмен</h2>
        <div className="mode-chips">
          {partners.map((p) => (
            <button
              key={p.id}
              className={p.id === partnerId ? 'chip wide active' : 'chip wide'}
              style={{ color: p.color }}
              disabled={alreadyAsked(p.id)}
              title={alreadyAsked(p.id) ? 'В этом круге уже предлагали' : undefined}
              onClick={() => choose(p.id)}
            >
              {p.name}
            </button>
          ))}
        </div>
        <OfferEditor state={state} player={player} title="Вы отдаёте" offer={give} onChange={setGive} />
        {partner && <OfferEditor state={state} player={partner} title={`Вы получаете от ${partner.name}`} offer={take} onChange={setTake} />}
        <small className="muted">Клетки кварталов с постройками передавать нельзя. Заложенные переходят вместе с залогом.</small>
        <div className="actions">
          <button className="btn primary" disabled={!partner || !canProposeTrade(state, trade)} onClick={() => onPropose(trade)}>
            Предложить
          </button>
          <button className="btn" onClick={onClose}>
            Отмена
          </button>
        </div>
      </div>
    </div>
  );
}
