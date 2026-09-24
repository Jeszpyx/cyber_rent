import { useEffect, useState } from 'react';
import { MODE_IDS, MODES } from '../../shared/game/modes';
import { MAX_PLAYERS, MIN_PLAYERS, type RoomView, type ServerConfig } from '../../shared/game/room';
import { useAnimation } from '../hooks/useAnimation';
import { useGameSounds } from '../hooks/useGameSounds';
import { useRoom, type RoomConnection } from '../hooks/useRoom';
import { useBackButton, useMainButton } from '../hooks/useTelegramButtons';
import { inviteLink, serverConfig, shareInvite } from '../online/api';
import { saveLastRoom } from '../online/onlineStorage';
import { GameScreen } from './Game';

interface Props {
  code: string;
  /** имя гостя; в Telegram сервер берёт имя из initData */
  name: string;
  onExit: () => void;
}

/** Онлайн-комната (G3): лобби до старта, затем общий экран партии. */
export function OnlineRoom({ code, name, onExit }: Props) {
  const room = useRoom(code, name);
  const { view } = room;

  if (room.fatal || !view) {
    return <RoomMessage code={code} text={room.fatal ?? (room.offline ? 'Нет связи с сервером, пробуем ещё…' : 'Подключаемся…')} onExit={onExit} />;
  }
  if (!view.state) return <RoomLobby room={room} view={view} onExit={onExit} />;
  return <OnlineGame room={room} view={view} onExit={onExit} />;
}

function RoomMessage({ code, text, onExit }: { code: string; text: string; onExit: () => void }) {
  useBackButton(onExit);
  useMainButton(null);
  return (
    <main className="start-screen">
      <div className="room-code">{code}</div>
      <p className="tagline">{text}</p>
      <button className="btn" onClick={onExit}>
        В меню
      </button>
    </main>
  );
}

interface RoomProps {
  room: RoomConnection;
  view: RoomView;
  onExit: () => void;
}

function RoomLobby({ room, view, onExit }: RoomProps) {
  const [config, setConfig] = useState<ServerConfig | null>(null);
  const [shareNote, setShareNote] = useState<string | null>(null);
  const total = view.members.length + view.bots;
  const canStart = view.isHost && total >= MIN_PLAYERS;
  const free = MAX_PLAYERS - total;

  useEffect(() => {
    let active = true;
    void serverConfig().then((c) => active && setConfig(c));
    return () => {
      active = false;
    };
  }, []);

  const share = async () => setShareNote(await shareInvite(inviteLink(config, view.id), view.id));
  const leave = async () => {
    await room.leave();
    onExit();
  };

  useBackButton(() => void leave());
  useMainButton(view.isHost ? { text: 'Начать партию', onClick: room.start, disabled: !canStart } : null);

  return (
    <main className="start-screen lobby">
      <div className="lobby-head">
        <span className="muted">Комната</span>
        <div className="room-code">{view.id}</div>
      </div>
      <div className="continue">
        <button className="btn primary" onClick={() => void share()}>
          Пригласить друга
        </button>
        <small>{shareNote ?? 'Или продиктуйте код — его вводят в меню «Онлайн».'}</small>
      </div>

      <ul className="lobby-members">
        {view.members.map((member) => (
          <li key={member}>
            {member === view.hostName && <span title="Хозяин комнаты">👑 </span>}
            {member}
          </li>
        ))}
        {Array.from({ length: view.bots }, (_, i) => (
          <li key={`bot${i}`} className="muted">
            🤖 бот
          </li>
        ))}
        {Array.from({ length: free }, (_, i) => (
          <li key={`free${i}`} className="free">
            свободное место
          </li>
        ))}
      </ul>

      <div className="mode-picker">
        {view.isHost ? (
          <>
            <div className="mode-chips">
              {MODE_IDS.map((id) => (
                <button key={id} className={id === view.mode ? 'chip wide active' : 'chip wide'} onClick={() => room.configure({ mode: id })}>
                  {MODES[id].name}
                </button>
              ))}
            </div>
            <div className="bots-picker">
              <span>Боты:</span>
              {Array.from({ length: MAX_PLAYERS - view.members.length + 1 }, (_, n) => (
                <button key={n} className={n === view.bots ? 'chip active' : 'chip'} onClick={() => room.configure({ bots: n })}>
                  {n}
                </button>
              ))}
            </div>
          </>
        ) : (
          <b>{MODES[view.mode].name}</b>
        )}
        <p className="mode-description">{MODES[view.mode].description}</p>
      </div>

      {view.isHost ? (
        <button className="btn primary big" disabled={!canStart} onClick={room.start}>
          Начать партию
        </button>
      ) : (
        <p className="tagline">Ждём, пока {view.hostName} начнёт партию.</p>
      )}
      {view.isHost && !canStart && <small className="muted">Нужно хотя бы {MIN_PLAYERS} игрока: позовите друга или добавьте бота.</small>}
      <button className="btn small" onClick={() => void leave()}>
        Покинуть комнату
      </button>
      {(room.notice || room.offline) && (
        <div className="toast" role="status">
          {room.offline ? 'Нет связи с сервером, переподключаемся…' : room.notice}
        </div>
      )}
    </main>
  );
}

function OnlineGame({ room, view, onExit }: RoomProps) {
  const state = view.state!;
  const localId = view.you;
  const animation = useAnimation(state, localId ?? '');
  useGameSounds(state, animation.busy, localId ?? '');
  const finished = view.status === 'finished';

  const exit = () => {
    // Законченную партию в меню больше не предлагаем.
    if (finished) saveLastRoom(null);
    onExit();
  };

  return (
    <GameScreen
      session={{ state, dispatch: room.act, deadline: room.deadline, animation, localId }}
      onExit={exit}
      exitTitle={finished ? 'Выйти в меню' : 'Партия продолжится без вас: за молчащего игрока через время ходит бот. Вернуться можно из меню.'}
      roomCode={view.id}
      notice={room.offline ? 'Нет связи с сервером, переподключаемся…' : room.notice}
    />
  );
}
