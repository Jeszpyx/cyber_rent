import { useState } from 'react';
import { availableBonus, bonusForStreak, claimBonus, spendBonus } from '../shared/game/dailyBonus';
import { DEFAULT_MODE, MODE_IDS, MODES, type GameModeId } from '../shared/game/modes';
import { NAME_MAX_LENGTH, ROOM_CODE_LENGTH, normalizeRoomCode } from '../shared/game/room';
import { BuildInfo } from './components/BuildInfo';
import { Game } from './components/Game';
import { OnlineRoom } from './components/OnlineRoom';
import { loadBonusRecord, saveBonusRecord, today } from './dailyBonusStorage';
import type { SavedGame } from '../shared/game/save';
import { loadSavedGame } from './gameStorage';
import type { GameInit } from './hooks/useGame';
import { useMainButton } from './hooks/useTelegramButtons';
import { ApiError, onlineApi } from './online/api';
import { loadGuestName, loadLastRoom, saveGuestName } from './online/onlineStorage';
import { isInTelegram, telegramStartParam, telegramUserName } from './telegram';

const savedAtFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

type Screen = { kind: 'menu' } | { kind: 'local'; init: GameInit } | { kind: 'online'; code: string; name: string };

/** Код комнаты из приглашения: startapp в Telegram (G5) или ?room= на сайте. */
function readInvite(): string | null {
  return normalizeRoomCode(telegramStartParam() ?? new URLSearchParams(location.search).get('room'));
}

export function App() {
  const [screen, setScreen] = useState<Screen>({ kind: 'menu' });
  const [gameKey, setGameKey] = useState(0);
  const [saved, setSaved] = useState(loadSavedGame);
  const [invite, setInvite] = useState(readInvite);

  const toMenu = () => {
    setScreen({ kind: 'menu' });
    // Партия сохраняется на каждом ходу: недоигранную можно продолжить из меню.
    setSaved(loadSavedGame());
  };

  if (screen.kind === 'local') return <Game key={gameKey} init={screen.init} onExit={toMenu} />;
  if (screen.kind === 'online') return <OnlineRoom key={screen.code} code={screen.code} name={screen.name} onExit={toMenu} />;

  return (
    <StartScreen
      saved={saved}
      invite={invite}
      onLaunch={(init) => {
        setGameKey((k) => k + 1);
        setScreen({ kind: 'local', init });
      }}
      onOnline={(code, name) => {
        // Приглашение срабатывает один раз: из комнаты возвращаемся в обычное меню.
        if (invite) {
          setInvite(null);
          history.replaceState(null, '', location.pathname);
        }
        setScreen({ kind: 'online', code, name });
      }}
    />
  );
}

interface StartProps {
  saved: SavedGame | null;
  /** код комнаты из ссылки-приглашения */
  invite: string | null;
  onLaunch: (init: GameInit) => void;
  onOnline: (code: string, name: string) => void;
}

/** Меню: продолжить сохранённую партию, начать новую или сыграть онлайн. */
function StartScreen({ saved, invite, onLaunch, onOnline }: StartProps) {
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

  const inTelegram = isInTelegram();
  const [guestName, setGuestName] = useState(loadGuestName);
  const [code, setCode] = useState('');
  const [onlineError, setOnlineError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const lastRoom = loadLastRoom();
  // В Telegram имя берёт сервер из проверенной initData, на сайте — из поля ввода.
  const onlineName = inTelegram ? (telegramUserName() ?? 'Игрок') : guestName.trim() || 'Игрок';

  const enter = (raw: string) => {
    const roomCode = normalizeRoomCode(raw);
    if (!roomCode) {
      setOnlineError(`Код комнаты — ${ROOM_CODE_LENGTH} букв и цифр, например K7M2QX.`);
      return;
    }
    saveGuestName(guestName);
    onOnline(roomCode, onlineName);
  };

  const createRoom = async () => {
    setCreating(true);
    setOnlineError(null);
    try {
      saveGuestName(guestName);
      const view = await onlineApi.create(onlineName, mode, bots);
      if (view) onOnline(view.id, onlineName);
    } catch (error) {
      setOnlineError(error instanceof ApiError ? error.message : 'Не удалось создать комнату.');
    } finally {
      setCreating(false);
    }
  };

  useMainButton(
    invite
      ? { text: 'Войти в комнату', onClick: () => enter(invite) }
      : saved
        ? { text: 'Продолжить партию', onClick: resume }
        : { text: 'Начать игру', onClick: start },
  );

  const savedPlayers = saved?.state.players.filter((p) => !p.bankrupt).length ?? 0;

  return (
    <main className="start-screen">
      <h1 className="logo">
        CYBER<span>RENT</span>
      </h1>
      <p className="tagline">Скупай районы мегаполиса. Собирай ренту. Разори конкурентов.</p>

      {invite && (
        <div className="continue">
          <button className="btn primary big" onClick={() => enter(invite)}>
            Войти в комнату {invite}
          </button>
          <small>Вас пригласили в онлайн-партию.</small>
        </div>
      )}

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

      <section className="online-menu">
        <h2>Онлайн с друзьями</h2>
        {!inTelegram && (
          <input
            className="text-input"
            value={guestName}
            maxLength={NAME_MAX_LENGTH}
            placeholder="Ваше имя"
            aria-label="Ваше имя"
            onChange={(e) => setGuestName(e.target.value)}
          />
        )}
        <button className="btn" disabled={creating} onClick={() => void createRoom()}>
          {creating ? 'Создаём…' : 'Создать комнату'}
        </button>
        <form
          className="join-row"
          onSubmit={(e) => {
            e.preventDefault();
            enter(code);
          }}
        >
          <input
            className="text-input code-input"
            value={code}
            maxLength={ROOM_CODE_LENGTH}
            placeholder="КОД"
            aria-label="Код комнаты"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
          <button className="btn" type="submit">
            Войти
          </button>
        </form>
        {lastRoom && !invite && (
          <button className="btn small" onClick={() => enter(lastRoom)}>
            Вернуться в комнату {lastRoom}
          </button>
        )}
        {onlineError && <small className="error">{onlineError}</small>}
        <small className="muted">Режим и число ботов берутся из настроек выше, в комнате их можно поменять.</small>
      </section>

      <BuildInfo extra={isInTelegram() ? 'Telegram Mini App' : 'web'} />
    </main>
  );
}
