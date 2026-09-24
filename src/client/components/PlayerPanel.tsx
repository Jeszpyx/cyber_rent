import type { CSSProperties } from 'react';
import type { GameState } from '../../shared/game/types';

/** you — своя фишка в онлайн-партии, помечается «(вы)»; в игре с ботами не нужна. */
export function PlayerPanel({ state, you = null }: { state: GameState; you?: string | null }) {
  return (
    <ul className="players">
      {state.players.map((p, i) => {
        const owned = Object.values(state.owners).filter((id) => id === p.id).length;
        const classes = ['player'];
        if (i === state.currentPlayer && state.phase !== 'gameOver') classes.push('current');
        if (p.bankrupt) classes.push('bankrupt');
        return (
          <li key={p.id} className={classes.join(' ')} style={{ '--pc': p.color } as CSSProperties}>
            <span className={p.isolation ? 'avatar isolated' : 'avatar'} aria-hidden>
              {p.name.trim().charAt(0).toUpperCase() || '?'}
            </span>
            <span className="player-name">
              {p.name}
              {p.id === you && <small className="you"> (вы)</small>}
            </span>
            <span className="player-money">{p.money}₵</span>
            <span className="player-owned">
              <span title="Клеток во владении">▦ {owned}</span>
              {p.isolation && <span title={`В Изоляторе, попыток: ${p.isolation.turnsLeft}`}>⛓ {p.isolation.turnsLeft}</span>}
              {p.releaseCards.length > 0 && <span title="Карточка освобождения">🔓 {p.releaseCards.length}</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
