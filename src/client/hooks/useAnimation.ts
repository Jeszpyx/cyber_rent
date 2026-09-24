import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { BOARD } from '../../shared/game/board';
import { DICE_MS, FAST_STEP_MS, JUMP_MS, LONG_MOVE_STEPS, STEP_MS } from '../../shared/game/timing';
import type { GameState } from '../../shared/game/types';
import { playCue, type Cue } from '../feedback';

interface Frame {
  /** позиции фишек, которые показываются вместо state.position, пока идёт анимация */
  shown: Record<string, number>;
  rolling: boolean;
  duration: number;
  cue?: Cue;
  /** вибрация только на событиях человека, звук — на всех */
  vibrate?: boolean;
}

export interface AnimationView {
  /** player id → клетка, где фишка показана сейчас (только у тех, кто ещё идёт) */
  shown: Record<string, number>;
  /** id игроков, чьи фишки сейчас в движении */
  moving: string[];
  rolling: boolean;
  /** анимация идёт: боты ждут, кнопки человека скрыты, таймер хода не тикает */
  busy: boolean;
}

const lastMoveId = (state: GameState) => state.moves.at(-1)?.id ?? 0;
const wrap = (index: number) => ((index % BOARD.length) + BOARD.length) % BOARD.length;

function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Проигрывает новые броски (state.rollCount) и перемещения (state.moves) по кадрам.
 * Состояние игры уже итоговое — хук только показывает, как фишки к нему шли.
 */
export function useAnimation(state: GameState, humanId: string): AnimationView {
  const [view, setView] = useState<AnimationView>({ shown: {}, moving: [], rolling: false, busy: false });
  // Сохранённая партия не проигрывает прошлые ходы заново.
  const seen = useRef({ roll: state.rollCount, move: lastMoveId(state) });
  const frames = useRef<Frame[]>([]);
  const timer = useRef<number | null>(null);

  const play = () => {
    const frame = frames.current.shift();
    if (!frame) {
      timer.current = null;
      setView({ shown: {}, moving: [], rolling: false, busy: false });
      return;
    }
    setView((prev) => {
      const shown = { ...prev.shown, ...frame.shown };
      return { shown, moving: Object.keys(shown), rolling: frame.rolling, busy: true };
    });
    if (frame.cue) playCue(frame.cue, frame.vibrate);
    timer.current = window.setTimeout(play, frame.duration);
  };

  // До отрисовки: иначе фишка на кадр мелькнёт в конечной клетке.
  useLayoutEffect(() => {
    const newRoll = state.rollCount > seen.current.roll;
    const moves = state.moves.filter((m) => m.id > seen.current.move);
    seen.current = { roll: state.rollCount, move: lastMoveId(state) };
    if ((!newRoll && moves.length === 0) || reducedMotion()) return;

    const start: Record<string, number> = {};
    for (const move of moves) if (!(move.playerId in start)) start[move.playerId] = move.from;
    const mine = state.players[state.currentPlayer].id === humanId;
    const added: Frame[] = [
      newRoll ? { shown: start, rolling: true, duration: DICE_MS, cue: 'dice', vibrate: mine } : { shown: start, rolling: false, duration: 0 },
    ];
    for (const move of moves) {
      const human = move.playerId === humanId;
      if (move.steps === 0) {
        added.push({ shown: { [move.playerId]: move.to }, rolling: false, duration: JUMP_MS, cue: 'jump', vibrate: human });
        continue;
      }
      const count = Math.abs(move.steps);
      const direction = Math.sign(move.steps);
      const duration = count > LONG_MOVE_STEPS ? FAST_STEP_MS : STEP_MS;
      for (let i = 1; i <= count; i++) {
        added.push({ shown: { [move.playerId]: wrap(move.from + direction * i) }, rolling: false, duration, cue: 'step', vibrate: human });
      }
    }
    frames.current.push(...added);
    if (timer.current === null) play();
  }, [state]);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
      frames.current = [];
    },
    [],
  );

  return view;
}
