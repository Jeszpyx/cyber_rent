import { useEffect, useReducer } from 'react';
import { decideBotAction } from '../../shared/game/bot';
import { applyAction, createGame, currentPlayer, type NewGameOptions } from '../../shared/game/engine';

const BOT_DELAY_MS = 650;

export function useGame(options: NewGameOptions) {
  const [state, dispatch] = useReducer(applyAction, options, createGame);

  useEffect(() => {
    if (!currentPlayer(state).isBot) return;
    const action = decideBotAction(state);
    if (!action) return;
    const timer = setTimeout(() => dispatch(action), BOT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [state]);

  return { state, dispatch };
}
