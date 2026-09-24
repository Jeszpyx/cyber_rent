import type { GameModeId } from './modes';

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
  /** таймаутов подряд; сбрасывается любым своим действием, на лимите режима игроком управляет бот */
  idleStrikes: number;
}

/**
 * 'isolation' — начало хода в Изоляторе: ROLL (на дубль), PAY_BAIL или USE_RELEASE_CARD.
 * 'debt' — должнику (state.debt, не обязательно текущему игроку) не хватает наличных:
 * SELL_BUILDING / MORTGAGE, затем PAY_DEBT или DECLARE_BANKRUPTCY.
 * 'auction' — торги за клетку (state.auction): участник, чья очередь, делает BID или PASS.
 * 'trade' — адресат обмена (state.trade.to) отвечает ACCEPT_TRADE или REJECT_TRADE.
 */
export type Phase =
  | 'roll'
  | 'isolation'
  | 'buyDecision'
  | 'auction'
  | 'card'
  | 'debt'
  | 'trade'
  | 'end'
  | 'gameOver';

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

/** Торги за свободную клетку: открытые ставки по кругу, PASS выводит из торгов насовсем. */
export interface Auction {
  index: number;
  /** текущая старшая ставка; 0 — ставок ещё не было */
  bid: number;
  /** чья ставка старшая */
  leaderId: string | null;
  /** оставшиеся участники по очереди; первый — тот, кто сейчас решает */
  queue: string[];
}

/** Что одна сторона обмена отдаёт другой. */
export interface TradeOffer {
  cells: number[];
  money: number;
  releaseCards: string[];
}

/** Предложение обмена: from отдаёт give и получает take от to. */
export interface Trade {
  from: string;
  to: string;
  give: TradeOffer;
  take: TradeOffer;
}

/** Предложение ждёт ответа адресата; resume — фаза хода, в которую игра вернётся после ответа. */
export interface PendingTrade extends Trade {
  resume: Phase;
}

export interface LogEntry {
  id: number;
  text: string;
}

export interface GameState {
  /** режим партии: правила и константы в MODES (modes.ts) */
  mode: GameModeId;
  /** номер круга с 1; круг заканчивается, когда ход возвращается к первому живому игроку */
  round: number;
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
  /** копилка «Нейтральной зоны»: все штрафы банку (settle с to: null, залог, таймаут); забирает попавший на клетку */
  pot: number;
  /** неоплаченный платёж в фазе 'debt' */
  debt: Debt | null;
  /** идущие торги в фазе 'auction' */
  auction: Auction | null;
  /** предложение обмена в фазе 'trade' */
  trade: PendingTrade | null;
  /** `${from}>${to}` → круг последнего предложения обмена: одному адресату — не чаще раза за круг (за ход) */
  tradeRounds: Record<string, number>;
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
  /** отказ от покупки: клетка уходит на торги */
  | { type: 'START_AUCTION' }
  | { type: 'BID'; amount: number }
  | { type: 'PASS' }
  | { type: 'APPLY_CARD' }
  | { type: 'PAY_BAIL' }
  | { type: 'USE_RELEASE_CARD' }
  | { type: 'BUILD'; index: number }
  | { type: 'SELL_BUILDING'; index: number }
  | { type: 'MORTGAGE'; index: number }
  | { type: 'UNMORTGAGE'; index: number }
  | { type: 'PAY_DEBT' }
  | { type: 'DECLARE_BANKRUPTCY' }
  /** from — всегда actingPlayer; поле нужно, чтобы предложение было самодостаточным */
  | { type: 'PROPOSE_TRADE'; trade: Trade }
  | { type: 'ACCEPT_TRADE' }
  | { type: 'REJECT_TRADE' }
  | { type: 'END_TURN' }
  /** время на решение вышло: штраф actingPlayer в копилку, затем за него действует бот */
  | { type: 'TIMEOUT' };
