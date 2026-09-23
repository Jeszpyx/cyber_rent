import type { GameState } from '../../shared/game/types';

export function PlayerPanel({ state }: { state: GameState }) {
  return (
    <ul className="players">
      {state.players.map((p, i) => {
        const owned = Object.values(state.owners).filter((id) => id === p.id).length;
        const classes = ['player'];
        if (i === state.currentPlayer && state.phase !== 'gameOver') classes.push('current');
        if (p.bankrupt) classes.push('bankrupt');
        return (
          <li key={p.id} className={classes.join(' ')} style={{ borderColor: p.color }}>
            <span className="token big" style={{ background: p.color }} />
            <span className="player-name">{p.name}</span>
            <span className="player-owned">🏢 {owned}</span>
            <span className="player-money">{p.money}₵</span>
          </li>
        );
      })}
    </ul>
  );
}
