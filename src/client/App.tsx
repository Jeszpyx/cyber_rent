import { useState } from 'react';
import { availableBonus, bonusForStreak, claimBonus, spendBonus } from '../shared/game/dailyBonus';
import { DEFAULT_MODE, MODE_IDS, MODES, type GameModeId } from '../shared/game/modes';
import { BuildInfo } from './components/BuildInfo';
import { Game } from './components/Game';
import { loadBonusRecord, saveBonusRecord, today } from './dailyBonusStorage';
import type { SavedGame } from '../shared/game/save';
import { loadSavedGame } from './gameStorage';
import type { GameInit } from './hooks/useGame';
import { useMainButton } from './hooks/useTelegramButtons';
import { isInTelegram, telegramUserName } from './telegram';

const savedAtFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export function App() {
  const [game, setGame] = useState<GameInit | null>(null);
  const [gameKey, setGameKey] = useState(0);
  const [saved, setSaved] = useState(loadSavedGame);

  if (game) {
    return (
      <Game
        key={gameKey}
        init={game}
        onExit={() => {
          setGame(null);
          // Партия сохраняется на каждом ходу: недоигранную можно продолжить из меню.
          setSaved(loadSavedGame());
        }}
      />
    );
  }

  return (
    <StartScreen
      saved={saved}
      onLaunch={(init) => {
        setGameKey((k) => k + 1);
        setGame(init);
      }}
    />
  );
}

interface StartProps {
  saved: SavedGame | null;
  onLaunch: (init: GameInit) => void;
}

/** Меню: продолжить сохранённую партию или начать новую. */
function StartScreen({ saved, onLaunch }: StartProps) {
  const [bots, setBots] = useState(3);
  const [mode, setMode] = useState<GameModeId>(DEFAULT_MODE);
  const [bonusRecord, setBonusRecord] = useState(loadBonusRecord);

  const bonus = availableBonus(bonusRecord, today());
  const unspent = bonusRecord?.unspent ?? 0;

  const claim = () => {
    const record = claimBonus(bonusRecord, today());
    saveBonusRecord(record);
    setBonusRecord(record);
  };

  const start = () => {
    if (bonusRecord && unspent > 0) {
      const record = spendBonus(bonusRecord);
      saveBonusRecord(record);
      setBonusRecord(record);
    }
    onLaunch({ options: { playerName: telegramUserName() ?? 'Игрок', bots, mode, startBonus: unspent } });
  };

  const resume = () => {
    if (saved) onLaunch({ state: saved.state });
  };

  useMainButton(saved ? { text: 'Продолжить партию', onClick: resume } : { text: 'Начать игру', onClick: start });

  const savedPlayers = saved?.state.players.filter((p) => !p.bankrupt).length ?? 0;

  return (
    <main className="start-screen">
      <h1 className="logo">
        CYBER<span>RENT</span>
      </h1>
      <p className="tagline">Скупай районы мегаполиса. Собирай ренту. Разори конкурентов.</p>

      {saved && (
        <div className="continue">
          <button className="btn primary big" onClick={resume}>
            Продолжить
          </button>
          <small>
            {MODES[saved.state.mode].name} · круг {saved.state.round} · в игре {savedPlayers} · {savedAtFormat.format(saved.savedAt)}
          </small>
        </div>
      )}

      <div className="mode-picker">
        <div className="mode-chips">
          {MODE_IDS.map((id) => (
            <button key={id} className={id === mode ? 'chip wide active' : 'chip wide'} onClick={() => setMode(id)}>
              {MODES[id].name}
            </button>
          ))}
        </div>
        <p className="mode-description">{MODES[mode].description}</p>
      </div>

      <div className="bots-picker">
        <span>Соперники-боты:</span>
        {[1, 2, 3].map((n) => (
          <button
            key={n}
            className={n === bots ? 'chip active' : 'chip'}
            onClick={() => setBots(n)}
          >
            {n}
          </button>
        ))}
      </div>

      <div className="daily-bonus">
        {bonus ? (
          <>
            <span>
              Ежедневный бонус, день {bonus.streak}: <b>+{bonus.amount}₵</b>
            </span>
            <button className="btn small primary" onClick={claim}>
              Забрать
            </button>
          </>
        ) : (
          <span>
            Бонус на сегодня получен. Завтра: +{bonusForStreak((bonusRecord?.streak ?? 0) + 1)}₵
          </span>
        )}
        {unspent > 0 && <small>+{unspent}₵ добавятся к стартовому капиталу партии</small>}
      </div>

      <button className={saved ? 'btn big' : 'btn primary big'} onClick={start}>
        {saved ? 'Новая игра' : 'Начать игру'}
      </button>
      {saved && <small className="muted">Новая игра заменит сохранённую партию.</small>}

      <BuildInfo extra={isInTelegram() ? 'Telegram Mini App' : 'web'} />
    </main>
  );
}
