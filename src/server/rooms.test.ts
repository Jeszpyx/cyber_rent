import { afterEach, describe, expect, it, vi } from 'vitest';
import { MODES } from '../shared/game/modes';
import type { Room } from '../shared/game/room';
import { SAVE_VERSION } from '../shared/game/save';
import { RoomError, RoomService } from './rooms';
import { MemoryStore } from './store';

const HOST = { userId: 'tg:1', name: 'Ника' };
const GUEST = { userId: 'g:2', name: 'Рэй' };

let now = 1_000_000;
let service: RoomService;
let store: MemoryStore;

function setup(): RoomService {
  store = new MemoryStore();
  service = new RoomService(store, () => now);
  return service;
}

afterEach(async () => {
  await service?.close();
  vi.useRealTimers();
});

async function rejects(promise: Promise<unknown>, status: number): Promise<string> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(RoomError);
    expect((error as RoomError).status).toBe(status);
    return (error as RoomError).message;
  }
  throw new Error('ожидалась ошибка');
}

describe('комнаты на сервере (G2)', () => {
  it('creates a room with a readable code, saves it and lets a friend join', async () => {
    const rooms = setup();
    const created = await rooms.create(HOST, 'blitz', 1);
    expect(created.id).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(created).toMatchObject({ status: 'lobby', mode: 'blitz', bots: 1, isHost: true, members: [HOST.name] });
    expect(await store.load(created.id)).not.toBeNull();

    const joined = await rooms.join(created.id, GUEST);
    expect(joined).toMatchObject({ isHost: false, members: [HOST.name, GUEST.name], bots: 1 });
    await rejects(rooms.view(created.id, 'g:чужой'), 403);
    await rejects(rooms.join('ZZZZZZ', GUEST), 404);
  });

  it('plays: only the acting player moves, others get the change by long-polling', async () => {
    const rooms = setup();
    const { id } = await rooms.create(HOST, 'classic', 0);
    const lobby = await rooms.join(id, GUEST);
    await rejects(rooms.start(id, GUEST.userId), 409);
    const started = await rooms.start(id, HOST.userId);
    expect(started.status).toBe('playing');
    expect(started.you).toBe('p0');
    expect(started.version).toBeGreaterThan(lobby.version);

    const waiting = rooms.waitForChange(id, GUEST.userId, started.version, 5_000);
    const message = await rejects(rooms.act(id, GUEST.userId, { type: 'ROLL' }), 409);
    expect(message).toMatch(/Ника/);
    const rolled = await rooms.act(id, HOST.userId, { type: 'ROLL' });
    const seen = await waiting;
    expect(seen?.version).toBe(rolled.version);
    expect(seen?.you).toBe('p1');
    expect(seen?.state?.rollCount).toBe(1);
  });

  it('long-polling answers at once for an old version and null on timeout or abort', async () => {
    const rooms = setup();
    const { id, version } = await rooms.create(HOST, 'classic', 1);
    expect((await rooms.waitForChange(id, HOST.userId, version - 1, 5_000))?.version).toBe(version);
    expect(await rooms.waitForChange(id, HOST.userId, version, 10)).toBeNull();
    const abort = new AbortController();
    const waiting = rooms.waitForChange(id, HOST.userId, version, 5_000, abort.signal);
    abort.abort();
    expect(await waiting).toBeNull();
  });

  it('players in the lobby see who left; the empty room is deleted', async () => {
    const rooms = setup();
    const { id, version } = await rooms.create(HOST, 'classic', 1);
    await rooms.join(id, GUEST);
    const waiting = rooms.waitForChange(id, GUEST.userId, version + 1, 5_000);
    await rooms.leave(id, HOST.userId);
    expect((await waiting)?.members).toEqual([GUEST.name]);
    expect(await rooms.leave(id, GUEST.userId)).toBeNull();
    expect(await store.load(id)).toBeNull();
  });

  it('catches up a missed deadline on the next request (process slept)', async () => {
    const rooms = setup();
    const { id } = await rooms.create(HOST, 'classic', 1);
    const started = await rooms.start(id, HOST.userId);
    now += MODES.classic.turnSeconds! * 1000 + 1;
    const view = await rooms.view(id, HOST.userId);
    expect(view.version).toBeGreaterThan(started.version);
    expect(view.state!.players[0].idleStrikes).toBe(1);
  });

  it('the timer times out a silent player and moves bots without any requests', async () => {
    vi.useFakeTimers();
    store = new MemoryStore();
    service = new RoomService(store);
    const { id } = await service.create(HOST, 'blitz', 1);
    const started = await service.start(id, HOST.userId);
    const saved = async () => (await store.load(id))!;

    await vi.advanceTimersByTimeAsync(MODES.blitz.turnSeconds! * 1000 - 100);
    expect((await saved()).version).toBe(started.version);
    await vi.advanceTimersByTimeAsync(200);
    const timedOut = await saved();
    expect(timedOut.version).toBeGreaterThan(started.version);
    expect(timedOut.state!.players[0].idleStrikes).toBe(1);

    // Молчащего игрока перехватывает бот, и партия доигрывается сама.
    for (let i = 0; i < 2_000 && (await saved()).state!.phase !== 'gameOver'; i++) await vi.advanceTimersByTimeAsync(60_000);
    const finished = await saved();
    expect(finished.state!.phase).toBe('gameOver');
    expect(finished.deadline).toBeNull();
    expect(finished.state!.players[0].isBot).toBe(true);
  });

  it('drops rooms of an old save format', async () => {
    const rooms = setup();
    const { id } = await rooms.create(HOST, 'classic', 1);
    const stale: Room = { ...(await store.load(id))!, saveVersion: SAVE_VERSION - 1 };
    await store.save(stale);
    const fresh = setup();
    await store.save(stale);
    await rejects(fresh.view(id, HOST.userId), 404);
    expect(await store.load(id)).toBeNull();
    await rooms.close();
  });
});
