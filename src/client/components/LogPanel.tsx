import { useLayoutEffect, useRef, useState } from 'react';
import type { GameState, LogKind } from '../../shared/game/types';

const KIND_FILTERS: { kind: LogKind | null; label: string }[] = [
  { kind: null, label: 'Всё' },
  { kind: 'move', label: 'Ходы' },
  { kind: 'money', label: 'Деньги' },
  { kind: 'deal', label: 'Сделки' },
  { kind: 'system', label: 'Партия' },
];

/** Если до низа меньше стольких px — лог «прилип» и прокручивается сам. */
const STICK_PX = 24;

/** Лог партии по порядку: фильтр по игроку и категории, автопрокрутка к новым записям. */
export function LogPanel({ state }: { state: GameState }) {
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [kind, setKind] = useState<LogKind | null>(null);
  const [stuck, setStuck] = useState(true);
  const list = useRef<HTMLOListElement>(null);

  const entries = state.log.filter((e) => (!playerId || e.players.includes(playerId)) && (!kind || e.kind === kind));
  const lastId = entries.at(-1)?.id ?? 0;
  const [readId, setReadId] = useState(lastId);

  useLayoutEffect(() => {
    const el = list.current;
    if (!el || !stuck) return;
    el.scrollTop = el.scrollHeight;
    setReadId(lastId);
  }, [lastId, stuck, playerId, kind]);

  const onScroll = () => {
    const el = list.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX;
    if (atBottom !== stuck) setStuck(atBottom);
  };

  const filter = (next: () => void) => {
    next();
    setStuck(true);
  };

  return (
    <section className="log-panel">
      <div className="log-filters" role="toolbar" aria-label="Фильтр лога">
        <button className={playerId === null ? 'tag active' : 'tag'} onClick={() => filter(() => setPlayerId(null))}>
          Все
        </button>
        {state.players.map((p) => (
          <button
            key={p.id}
            className={playerId === p.id ? 'tag active' : 'tag'}
            style={{ color: p.color }}
            onClick={() => filter(() => setPlayerId(p.id))}
          >
            {p.name}
          </button>
        ))}
      </div>
      <div className="log-filters" role="toolbar" aria-label="Категория событий">
        {KIND_FILTERS.map((f) => (
          <button key={f.label} className={kind === f.kind ? 'tag active' : 'tag'} onClick={() => filter(() => setKind(f.kind))}>
            {f.label}
          </button>
        ))}
      </div>
      <div className="log-wrap">
        <ol className="log" ref={list} onScroll={onScroll}>
          {entries.map((entry) => (
            <li key={entry.id} className={`log-${entry.kind}`}>
              {entry.text}
            </li>
          ))}
          {entries.length === 0 && <li className="muted">Здесь пока пусто.</li>}
        </ol>
        {!stuck && lastId > readId && (
          <button className="btn small log-new" onClick={() => setStuck(true)}>
            ↓ Новые события
          </button>
        )}
      </div>
    </section>
  );
}
