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

export interface Player {
  id: string;
  name: string;
  isBot: boolean;
  color: string;
  money: number;
  position: number;
  bankrupt: boolean;
}

export type Phase = 'roll' | 'buyDecision' | 'end' | 'gameOver';

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
  /** cell index → owner player id */
  owners: Record<number, string>;
  seed: number;
  log: LogEntry[];
  logCounter: number;
  winnerId: string | null;
}

export type Action =
  | { type: 'ROLL' }
  | { type: 'BUY' }
  | { type: 'SKIP_BUY' }
  | { type: 'END_TURN' };
