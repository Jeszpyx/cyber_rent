import { isResumable, parseSavedGame, serializeGame, type SavedGame } from '../shared/game/save';
import type { GameState } from '../shared/game/types';

/** Пока нет сервера (блок G), идущая партия сохраняется в localStorage этого устройства. */
const KEY = 'cyber-rent:save';

export function loadSavedGame(): SavedGame | null {
  try {
    return parseSavedGame(localStorage.getItem(KEY));
  } catch {
    return null;
  }
}

/** Сохраняет идущую партию; законченную — стирает, продолжать там нечего. */
export function saveGame(state: GameState): void {
  try {
    if (isResumable(state)) localStorage.setItem(KEY, serializeGame(state, Date.now()));
    else localStorage.removeItem(KEY);
  } catch {
    // хранилище недоступно или переполнено — партия просто не сохранится
  }
}
