import { useEffect, useReducer } from 'react';
import { decideBotAction } from '../../shared/game/bot';
import { applyAction, createGame, currentPlayer, type NewGameOptions } from '../../shared/game/engine';

const BOT_DELAY_MS = 650;
/** Карточку бота держим дольше, чтобы человек успел прочитать. */
const BOT_CARD_DELAY_MS = 2000;

export function useGame(options: NewGameOptions) {
  const [state, dispatch] = useReducer(applyAction, options, createGame);

  useEffect(() => {
    if (!currentPlayer(state).isBot) return;
    const action = decideBotAction(state);
    if (!action) return;
    const delay = state.phase === 'card' ? BOT_CARD_DELAY_MS : BOT_DELAY_MS;
    const timer = setTimeout(() => dispatch(action), delay);
    return () => clearTimeout(timer);
  }, [state]);

  return { state, dispatch };
}
