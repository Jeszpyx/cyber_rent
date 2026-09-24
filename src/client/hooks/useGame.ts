import { useEffect, useReducer, useState } from 'react';
import { decideBotAction } from '../../shared/game/bot';
import { actingPlayer, applyAction, createGame, type NewGameOptions } from '../../shared/game/engine';
import { MODES } from '../../shared/game/modes';

const BOT_DELAY_MS = 650;
/** Карточку бота держим дольше, чтобы человек успел прочитать. */
const BOT_CARD_DELAY_MS = 2000;

export function useGame(options: NewGameOptions) {
  const [state, dispatch] = useReducer(applyAction, options, createGame);
  /** Когда у живого игрока выйдет время на решение (ms); null — таймер не идёт. */
  const [deadline, setDeadline] = useState<number | null>(null);

  useEffect(() => {
    if (state.phase === 'gameOver') {
      setDeadline(null);
      return;
    }
    // В фазе долга решает должник, а не обязательно тот, чей ход.
    if (actingPlayer(state).isBot) {
      setDeadline(null);
      const action = decideBotAction(state);
      if (!action) return;
      const delay = state.phase === 'card' ? BOT_CARD_DELAY_MS : BOT_DELAY_MS;
      const timer = setTimeout(() => dispatch(action), delay);
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
  }, [state]);

  return { state, dispatch, deadline };
}
