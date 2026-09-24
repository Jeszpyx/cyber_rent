import { useEffect, useReducer, useState } from 'react';
import { decideBotAction } from '../../shared/game/bot';
import { actingPlayer, applyAction, createGame, type NewGameOptions } from '../../shared/game/engine';
import { MODES } from '../../shared/game/modes';
import { botDelayMs } from '../../shared/game/timing';
import type { Action, GameState } from '../../shared/game/types';
import { saveGame } from '../gameStorage';
import { useAnimation, type AnimationView } from './useAnimation';
import { useGameSounds } from './useGameSounds';

/** Новая партия или продолжение сохранённой. */
export type GameInit = { options: NewGameOptions } | { state: GameState };

/** Всё, что нужно экрану партии, — одинаково для игры с ботами и онлайн-комнаты. */
export interface GameSession {
  state: GameState;
  dispatch: (action: Action) => void;
  /** когда у живого игрока выйдет время на решение (ms, часы этого устройства); null — таймер не идёт */
  deadline: number | null;
  animation: AnimationView;
  /** id фишки, которой управляет этот экран; null — зритель */
  localId: string | null;
}

function init(source: GameInit): GameState {
  return 'state' in source ? source.state : createGame(source.options);
}

export function useGame(source: GameInit): GameSession {
  const [state, dispatch] = useReducer(applyAction, source, init);
  const [deadline, setDeadline] = useState<number | null>(null);
  // Человек всегда первый игрок (createGame); после таймаутов им может управлять бот.
  const humanId = state.players[0].id;
  const animation = useAnimation(state, humanId);
  useGameSounds(state, animation.busy, humanId);

  useEffect(() => saveGame(state), [state]);

  useEffect(() => {
    // Пока фишка идёт, боты не ходят и время человека не тикает.
    if (state.phase === 'gameOver' || animation.busy) {
      setDeadline(null);
      return;
    }
    // В фазе долга решает должник, а не обязательно тот, чей ход.
    if (actingPlayer(state).isBot) {
      setDeadline(null);
      const action = decideBotAction(state);
      if (!action) return;
      const timer = setTimeout(() => dispatch(action), botDelayMs(state));
      return () => clearTimeout(timer);
    }
    // Любое действие человека меняет состояние и перезапускает отсчёт.
    const seconds = MODES[state.mode].turnSeconds;
    if (seconds === null) {
      setDeadline(null);
      return;
    }
    setDeadline(Date.now() + seconds * 1000);
    const timer = setTimeout(() => dispatch({ type: 'TIMEOUT' }), seconds * 1000);
    return () => clearTimeout(timer);
  }, [state, animation.busy]);

  return { state, dispatch, deadline, animation, localId: humanId };
}
