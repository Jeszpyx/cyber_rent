import { MODES } from './modes';
import type { GameState } from './types';

/**
 * Версия формата сохранения. Поднимать при любом несовместимом изменении GameState:
 * сохранение старой версии не загружается, игроку предлагается новая партия.
 */
export const SAVE_VERSION = 1;

export interface SavedGame {
  version: number;
  /** ms since epoch */
  savedAt: number;
  state: GameState;
}

/** Сохранять имеет смысл только идущую партию. */
export function isResumable(state: GameState): boolean {
  return state.phase !== 'gameOver';
}

export function serializeGame(state: GameState, savedAt: number): string {
  const save: SavedGame = { version: SAVE_VERSION, savedAt, state };
  return JSON.stringify(save);
}

/** Разбирает сохранение; null — битое, другой версии или партия уже закончена. */
export function parseSavedGame(raw: string | null): SavedGame | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(data) || data.version !== SAVE_VERSION || typeof data.savedAt !== 'number') return null;
  const state = data.state;
  if (!isRecord(state) || !(typeof state.mode === 'string' && state.mode in MODES)) return null;
  if (!Array.isArray(state.players) || state.players.length < 2 || !Array.isArray(state.log)) return null;
  if (typeof state.phase !== 'string' || !isRecord(state.stats) || !Array.isArray(state.moves)) return null;
  const save = data as unknown as SavedGame;
  return isResumable(save.state) ? save : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
