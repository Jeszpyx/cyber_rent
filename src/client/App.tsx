import { useState } from 'react';
import { availableBonus, bonusForStreak, claimBonus, spendBonus } from '../shared/game/dailyBonus';
import type { NewGameOptions } from '../shared/game/engine';
import { DEFAULT_MODE, MODE_IDS, MODES, type GameModeId } from '../shared/game/modes';
import { BuildInfo } from './components/BuildInfo';
import { Game } from './components/Game';
import { loadBonusRecord, saveBonusRecord, today } from './dailyBonusStorage';
import { isInTelegram, telegramUserName } from './telegram';

export function App() {
  const [options, setOptions] = useState<NewGameOptions | null>(null);
  const [gameKey, setGameKey] = useState(0);
  const [bots, setBots] = useState(3);
  const [mode, setMode] = useState<GameModeId>(DEFAULT_MODE);
  const [bonusRecord, setBonusRecord] = useState(loadBonusRecord);

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
    setOptions({ playerName: telegramUserName() ?? 'Игрок', bots, mode, startBonus: unspent });
  };

  return (
    <main className="start-screen">
      <h1 className="logo">
        CYBER<span>RENT</span>
      </h1>
      <p className="tagline">Скупай районы мегаполиса. Собирай ренту. Разори конкурентов.</p>

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

      <button className="btn primary big" onClick={start}>
        Начать игру
      </button>

      <BuildInfo extra={isInTelegram() ? 'Telegram Mini App' : 'web'} />
    </main>
  );
}
