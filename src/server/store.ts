import { Pool } from 'pg';
import type { Room } from '../shared/game/room';

/** Где лежат комнаты. Room хранится целиком одним JSON-документом. */
export interface RoomStore {
  readonly kind: 'postgres' | 'memory';
  load(id: string): Promise<Room | null>;
  save(room: Room): Promise<void>;
  remove(id: string): Promise<void>;
  /** удаляет комнаты, которые не менялись с момента olderThan (ms since epoch); возвращает, сколько удалено */
  purge(olderThan: number): Promise<number>;
  close(): Promise<void>;
}

/** Без DATABASE_URL (локально и в тестах): комнаты живут, пока жив процесс. */
export class MemoryStore implements RoomStore {
  readonly kind = 'memory';
  private rooms = new Map<string, string>();

  async load(id: string): Promise<Room | null> {
    const raw = this.rooms.get(id);
    return raw ? (JSON.parse(raw) as Room) : null;
  }

  async save(room: Room): Promise<void> {
    this.rooms.set(room.id, JSON.stringify(room));
  }

  async remove(id: string): Promise<void> {
    this.rooms.delete(id);
  }

  async purge(olderThan: number): Promise<number> {
    let removed = 0;
    for (const [id, raw] of this.rooms) {
      if ((JSON.parse(raw) as Room).updatedAt < olderThan) {
        this.rooms.delete(id);
        removed += 1;
      }
    }
    return removed;
  }

  async close(): Promise<void> {}
}

/** PostgreSQL (DATABASE_URL): таблица rooms создаётся сама при первом обращении. */
export class PostgresStore implements RoomStore {
  readonly kind = 'postgres';
  private pool: Pool;
  private ready: Promise<void> | null = null;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 5 });
    // Обрыв простаивающего соединения (перезапуск БД, сеть) не должен ронять сервер.
    this.pool.on('error', (error) => console.error('Postgres idle client error:', error.message));
  }

  private ensureTable(): Promise<void> {
    this.ready ??= this.pool
      .query(
        `CREATE TABLE IF NOT EXISTS rooms (
           id text PRIMARY KEY,
           data jsonb NOT NULL,
           updated_at timestamptz NOT NULL
         );
         CREATE INDEX IF NOT EXISTS rooms_updated_at ON rooms (updated_at);`,
      )
      .then(
        () => undefined,
        (error: unknown) => {
          // Следующий запрос попробует ещё раз.
          this.ready = null;
          throw error;
        },
      );
    return this.ready;
  }

  async load(id: string): Promise<Room | null> {
    await this.ensureTable();
    const result = await this.pool.query<{ data: Room }>('SELECT data FROM rooms WHERE id = $1', [id]);
    return result.rows[0]?.data ?? null;
  }

  async save(room: Room): Promise<void> {
    await this.ensureTable();
    await this.pool.query(
      `INSERT INTO rooms (id, data, updated_at) VALUES ($1, $2, to_timestamp($3 / 1000.0))
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at`,
      [room.id, JSON.stringify(room), room.updatedAt],
    );
  }

  async remove(id: string): Promise<void> {
    await this.ensureTable();
    await this.pool.query('DELETE FROM rooms WHERE id = $1', [id]);
  }

  async purge(olderThan: number): Promise<number> {
    await this.ensureTable();
    const result = await this.pool.query('DELETE FROM rooms WHERE updated_at < to_timestamp($1 / 1000.0)', [olderThan]);
    return result.rowCount ?? 0;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export function createStore(databaseUrl: string | undefined): RoomStore {
  return databaseUrl ? new PostgresStore(databaseUrl) : new MemoryStore();
}
