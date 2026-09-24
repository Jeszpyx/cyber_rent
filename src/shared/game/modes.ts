import { START_MONEY, START_SALARY } from './board';

/**
 * Режимы партии. Все числа, которые разработчику может понадобиться подкрутить
 * (стартовый капитал, зарплата, время на ход, штрафы, лимит кругов, инфляция), лежат здесь.
 * Новый режим — новая запись в MODES; движок читает только поля GameMode.
 */
export type GameModeId = 'classic' | 'blitz' | 'inflation';

export interface GameMode {
  id: GameModeId;
  name: string;
  description: string;
  startMoney: number;
  /** зарплата за проход Старта */
  salary: number;
  /** время на решение живого игрока в секундах; null — без таймера */
  turnSeconds: number | null;
  /** штраф за таймаут в копилку «Нейтральной зоны» — только наличными, без банкротства */
  idleFine: number;
  /** столько таймаутов подряд — и игроком управляет бот */
  idleStrikesLimit: number;
  /** после стольких кругов партия заканчивается победой по капиталу; null — без лимита */
  roundLimit: number | null;
  /** каждые everyRounds кругов вся рента умножается на factor; null — рента не растёт */
  rentGrowth: { everyRounds: number; factor: number } | null;
}

const BASE = {
  startMoney: START_MONEY,
  salary: START_SALARY,
  turnSeconds: 60,
  idleFine: 50,
  idleStrikesLimit: 3,
  roundLimit: null,
  rentGrowth: null,
} satisfies Omit<GameMode, 'id' | 'name' | 'description'>;

export const MODES: Record<GameModeId, GameMode> = {
  classic: {
    ...BASE,
    id: 'classic',
    name: 'Классика',
    description: 'Играем до последнего выжившего.',
  },
  blitz: {
    ...BASE,
    id: 'blitz',
    name: 'Блиц',
    description: '30 кругов, 30 секунд на решение. Побеждает самый богатый по капиталу.',
    turnSeconds: 30,
    roundLimit: 30,
  },
  inflation: {
    ...BASE,
    id: 'inflation',
    name: 'Инфляция',
    description: 'Каждые 45 кругов вся рента удваивается — рано или поздно кто-то разорится.',
    rentGrowth: { everyRounds: 45, factor: 2 },
  },
};

export const MODE_IDS = Object.keys(MODES) as GameModeId[];
export const DEFAULT_MODE: GameModeId = 'classic';
