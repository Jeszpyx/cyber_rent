import { DECK_NAMES } from '../../shared/game/cards';
import type { Card, Player } from '../../shared/game/types';

interface Props {
  card: Card;
  player: Player;
  onApply?: () => void;
}

/** Вытянутая карточка. Без onApply (ход бота) кнопки нет — бот закрывает её сам. */
export function DrawnCard({ card, player, onApply }: Props) {
  return (
    <div className="overlay">
      <div className={`modal drawn-card ${card.deck}`}>
        <small className="drawn-card-deck">{DECK_NAMES[card.deck]}</small>
        <p className="drawn-card-text">{card.text}</p>
        <small style={{ color: player.color }}>{player.name}</small>
        {onApply ? (
          <button className="btn primary" onClick={onApply} autoFocus>
            ОК
          </button>
        ) : (
          <span className="thinking">бот читает…</span>
        )}
      </div>
    </div>
  );
}
