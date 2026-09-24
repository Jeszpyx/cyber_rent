import { gameMode } from '../../shared/game/economy';
import { gameResults } from '../../shared/game/engine';
import type { GameState, PlayerStats } from '../../shared/game/types';

const MEDALS = ['🥇', '🥈', '🥉'];

/** Строки статистики игрока: подпись и значение. */
const STAT_ROWS: { label: string; value: (s: PlayerStats) => string }[] = [
  { label: 'Рента получена', value: (s) => `${s.rentReceived}₵` },
  { label: 'Рента уплачена', value: (s) => `${s.rentPaid}₵` },
  { label: 'Куплено клеток', value: (s) => (s.auctionsWon > 0 ? `${s.cellsBought} (торги: ${s.auctionsWon})` : `${s.cellsBought}`) },
  { label: 'Построек', value: (s) => `${s.built}` },
  { label: 'Обменов', value: (s) => `${s.trades}` },
  { label: 'Из копилки', value: (s) => `${s.potCollected}₵` },
  { label: 'Пик капитала', value: (s) => `${s.peakWorth}₵` },
];

interface Props {
  state: GameState;
  onNewGame: () => void;
  /** закрыть итоги и посмотреть на доску */
  onClose: () => void;
}

/** Итоги партии: места, капитал и статистика каждого игрока. */
export function GameSummary({ state, onNewGame, onClose }: Props) {
  const results = gameResults(state);
  const winner = results[0].player;
  const mode = gameMode(state);
  const byLimit = results.filter((r) => !r.player.bankrupt).length > 1;

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal summary" onClick={(e) => e.stopPropagation()}>
        <small className="summary-mode">
          Итоги партии · {mode.name} · кругов: {state.round}
        </small>
        <h2 style={{ color: winner.color }}>{winner.name} побеждает!</h2>
        <p className="muted summary-reason">
          {byLimit ? 'Лимит кругов исчерпан — победа по капиталу.' : 'Остальные разорились — город принадлежит победителю.'}
        </p>
        <ol className="summary-list">
          {results.map(({ place, player, worth, stats }) => (
            <li key={player.id} className="summary-player" style={{ borderColor: player.color }}>
              <div className="summary-head">
                <span className="summary-place">{MEDALS[place - 1] ?? `${place}.`}</span>
                <b className="summary-name" style={{ color: player.color }}>
                  {player.name}
                </b>
                <span className="summary-worth">{stats.out ? `банкрот, круг ${stats.out.round}` : `${worth}₵`}</span>
              </div>
              <dl className="summary-stats">
                {STAT_ROWS.map((row) => (
                  <div key={row.label}>
                    <dt>{row.label}</dt>
                    <dd>{row.value(stats)}</dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ol>
        <div className="actions">
          <button className="btn primary" onClick={onNewGame}>
            Новая игра
          </button>
          <button className="btn" onClick={onClose}>
            К доске
          </button>
        </div>
      </div>
    </div>
  );
}
