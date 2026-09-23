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

/** Рента района: [0] без построек, [1..4] — модули, [5] — небоскрёб */
export type RentTable = [number, number, number, number, number, number];

export type Cell =
  | (CellBase & { kind: 'start' })
  | (CellBase & { kind: 'district'; group: DistrictGroup; price: number; rent: RentTable })
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

/**
 * 'isolation' — начало хода в Изоляторе: ROLL (на дубль), PAY_BAIL или USE_RELEASE_CARD.
 * 'debt' — должнику (state.debt, не обязательно текущему игроку) не хватает наличных:
 * SELL_BUILDING / MORTGAGE, затем PAY_DEBT или DECLARE_BANKRUPTCY.
 */
export type Phase = 'roll' | 'isolation' | 'buyDecision' | 'card' | 'debt' | 'end' | 'gameOver';

/** Обязательный платёж; to === null — банку */
export interface Payment {
  from: string;
  to: string | null;
  amount: number;
}

export interface Debt extends Payment {
  /** платежи, которые ждут своей очереди после этого долга */
  queue: Payment[];
  /** чем продолжить ход после расчёта: 'finish' — finishMove, 'move' — выход из Изолятора и ход на сумму кубиков */
  then: 'finish' | 'move';
}

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
  /** cell index → уровень застройки: 1–4 модуля, 5 — небоскрёб; 0 не хранится */
  buildings: Record<number, number>;
  /** заложенные клетки: рента не берётся, строить в квартале нельзя */
  mortgaged: Record<number, true>;
  /** неоплаченный платёж в фазе 'debt' */
  debt: Debt | null;
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
  | { type: 'BUILD'; index: number }
  | { type: 'SELL_BUILDING'; index: number }
  | { type: 'MORTGAGE'; index: number }
  | { type: 'UNMORTGAGE'; index: number }
  | { type: 'PAY_DEBT' }
  | { type: 'DECLARE_BANKRUPTCY' }
  | { type: 'END_TURN' };
