import type { GameState } from './types';

/**
 * Темп партии: паузы ботов и длительность анимации хода в клиенте (useAnimation).
 * Сервер онлайн-комнаты по этим же числам ждёт, пока фишка дойдёт, прежде чем ходит бот
 * или запускается таймер живого игрока.
 */
export const BOT_DELAY_MS = 650;
/** Карточку бота держим дольше, чтобы человек успел прочитать. */
export const BOT_CARD_DELAY_MS = 2000;

/** Сколько крутятся кубики, длительность шага фишки и паузы после переноса в Изолятор (ms). */
export const DICE_MS = 650;
export const STEP_MS = 150;
export const JUMP_MS = 450;
/** Шаги длиннее этого проигрываются быстрее (перемещение карточкой через полполя). */
export const LONG_MOVE_STEPS = 12;
export const FAST_STEP_MS = 70;

export function botDelayMs(state: GameState): number {
  return state.phase === 'card' ? BOT_CARD_DELAY_MS : BOT_DELAY_MS;
}

/** Длительность одного перемещения фишки в анимации. */
export function moveMs(steps: number): number {
  if (steps === 0) return JUMP_MS;
  const count = Math.abs(steps);
  return count * (count > LONG_MOVE_STEPS ? FAST_STEP_MS : STEP_MS);
}

/** Сколько клиент будет показывать переход от prev к next: новый бросок и новые перемещения. */
export function animationMs(prev: GameState, next: GameState): number {
  const seen = prev.moves.at(-1)?.id ?? 0;
  let total = next.rollCount > prev.rollCount ? DICE_MS : 0;
  for (const move of next.moves) if (move.id > seen) total += moveMs(move.steps);
  return total;
}
