export type DistrictGroup =
  | 'rust'
  | 'neon'
  | 'violet'
  | 'orange'
  | 'red'
  | 'yellow'
  | 'green'
  | 'blue';

interface CellBase {
  index: number;
  name: string;
  short: string;
}

export type Cell =
  | (CellBase & { kind: 'start' })
  | (CellBase & { kind: 'district'; group: DistrictGroup; price: number; rent: number })
  | (CellBase & { kind: 'transit'; price: number })
  | (CellBase & { kind: 'utility'; price: number })
  | (CellBase & { kind: 'tax'; amount: number })
  | (CellBase & { kind: 'hack' })
  | (CellBase & { kind: 'net' })
  | (CellBase & { kind: 'isolation' })
  | (CellBase & { kind: 'goToIsolation' })
  | (CellBase & { kind: 'neutral' });

export type OwnableCell = Extract<Cell, { price: number }>;

export type CardDeck = 'hack' | 'net';

export type CardEffect =
  /** amount > 0 — получить от банка, < 0 — заплатить банку */
  | { type: 'money'; amount: number }
  /** переход на клетку; за проход Старта — зарплата */
  | { type: 'moveTo'; index: number }
  /** steps < 0 — назад (без зарплаты за Старт) */
  | { type: 'moveBy'; steps: number }
  | { type: 'goToIsolation' }
  | { type: 'payEachPlayer'; amount: number }
  | { type: 'collectFromEachPlayer'; amount: number }
  | { type: 'getOutOfIsolation' }
  | { type: 'repairs'; perModule: number; perTower: number };

export interface Card {
  id: string;
  deck: CardDeck;
  text: string;
  effect: CardEffect;
}

export interface Player {
  id: string;
  name: string;
  isBot: boolean;
  color: string;
  money: number;
  position: number;
  bankrupt: boolean;
  /** id карточек освобождения из Изолятора на руках */
  releaseCards: string[];
  /** null — на свободе; turnsLeft — сколько попыток выбросить дубль осталось */
  isolation: { turnsLeft: number } | null;
}

/** 'isolation' — начало хода в Изоляторе: ROLL (на дубль), PAY_BAIL или USE_RELEASE_CARD */
export type Phase = 'roll' | 'isolation' | 'buyDecision' | 'card' | 'end' | 'gameOver';

export interface LogEntry {
  id: number;
  text: string;
}

export interface GameState {
  players: Player[];
  currentPlayer: number;
  phase: Phase;
  dice: [number, number] | null;
  rolledDouble: boolean;
  /** дублей подряд за текущий ход; DOUBLES_TO_ISOLATION → в Изолятор */
  doublesInRow: number;
  /** cell index → owner player id */
  owners: Record<number, string>;
  /** cell index → уровень застройки: 1–4 модуля, 5 — небоскрёб (заполняется в блоке C) */
  buildings: Record<number, number>;
  /** id карточек, верх колоды — первый элемент */
  decks: Record<CardDeck, string[]>;
  /** вытянутая карточка, ждёт APPLY_CARD */
  pendingCard: string | null;
  seed: number;
  log: LogEntry[];
  logCounter: number;
  winnerId: string | null;
}

export type Action =
  | { type: 'ROLL' }
  | { type: 'BUY' }
  | { type: 'SKIP_BUY' }
  | { type: 'APPLY_CARD' }
  | { type: 'PAY_BAIL' }
  | { type: 'USE_RELEASE_CARD' }
  | { type: 'END_TURN' };
