import { useSyncExternalStore } from 'react';

export interface BoardLayout {
  orientation: 'portrait' | 'landscape';
  /** Колонок и рядов сетки; клеток по периметру 2·(cols + rows) − 4 = 40 */
  cols: number;
  rows: number;
  /** Клетка в правом нижнем углу; от неё индексы идут по часовой стрелке */
  offset: number;
}

/**
 * Поле вытянуто вдоль длинной стороны экрана. Сдвиг подобран так, чтобы в углах
 * стояли Изолятор, Арест, «Сеть» и «Взлом», а не районы.
 */
const LAYOUTS: Record<BoardLayout['orientation'], BoardLayout> = {
  portrait: { orientation: 'portrait', cols: 9, rows: 13, offset: 2 },
  landscape: { orientation: 'landscape', cols: 13, rows: 9, offset: 30 },
};

const query = typeof window === 'undefined' ? null : window.matchMedia('(orientation: landscape)');

function subscribe(onChange: () => void): () => void {
  query?.addEventListener('change', onChange);
  return () => query?.removeEventListener('change', onChange);
}

const isLandscape = () => query?.matches ?? false;

export function useBoardLayout(): BoardLayout {
  return LAYOUTS[useSyncExternalStore(subscribe, isLandscape) ? 'landscape' : 'portrait'];
}

export type CellSide = 'top' | 'right' | 'bottom' | 'left' | 'corner';

/** Клетка → 1-based [ряд, колонка] сетки и сторона поля, к которой она прилегает. */
export function gridPosition(index: number, { cols, rows, offset }: BoardLayout): [number, number, CellSide] {
  const count = 2 * (cols + rows) - 4;
  const p = (index - offset + count) % count;
  const bottomLeft = cols - 1;
  const topLeft = bottomLeft + rows - 1;
  const topRight = topLeft + cols - 1;
  if (p === 0) return [rows, cols, 'corner'];
  if (p < bottomLeft) return [rows, cols - p, 'bottom'];
  if (p === bottomLeft) return [rows, 1, 'corner'];
  if (p < topLeft) return [rows - (p - bottomLeft), 1, 'left'];
  if (p === topLeft) return [1, 1, 'corner'];
  if (p < topRight) return [1, 1 + (p - topLeft), 'top'];
  if (p === topRight) return [1, cols, 'corner'];
  return [1 + (p - topRight), cols, 'right'];
}
