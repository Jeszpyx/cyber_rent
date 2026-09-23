import { useState } from 'react';
import type { NewGameOptions } from '../shared/game/engine';
import { BuildInfo } from './components/BuildInfo';
import { Game } from './components/Game';
import { isInTelegram, telegramUserName } from './telegram';

export function App() {
  const [options, setOptions] = useState<NewGameOptions | null>(null);
  const [gameKey, setGameKey] = useState(0);
  const [bots, setBots] = useState(3);

  if (options) {
    return (
      <Game
        key={gameKey}
        options={options}
        onRestart={() => {
          setOptions(null);
          setGameKey((k) => k + 1);
        }}
      />
    );
  }

  return (
    <main className="start-screen">
      <h1 className="logo">
        CYBER<span>RENT</span>
      </h1>
      <p className="tagline">Скупай районы мегаполиса. Собирай ренту. Разори конкурентов.</p>

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

      <button
        className="btn primary big"
        onClick={() => setOptions({ playerName: telegramUserName() ?? 'Игрок', bots })}
      >
        Начать игру
      </button>

      <BuildInfo extra={isInTelegram() ? 'Telegram Mini App' : 'web'} />
    </main>
  );
}
