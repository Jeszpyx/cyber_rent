import express, { type NextFunction, type Request, type Response } from 'express';
import { normalizeName, normalizeRoomCode, parseAction, type RoomUser, type ServerConfig } from '../shared/game/room';
import { identify, type Identity } from './auth';
import { RoomError, type RoomService } from './rooms';

/** Столько держится long-polling запрос без изменений: меньше типичных таймаутов прокси (30–120 с). */
export const POLL_TIMEOUT_MS = 25_000;
const GUEST_NAME = 'Гость';

export interface ApiConfig {
  /** токен бота для проверки initData; без него вход через Telegram отключён */
  botToken?: string;
  /** username бота и short name Mini App для ссылки-приглашения t.me/<bot>/<app>?startapp=<код> */
  botUsername?: string;
  appShortName?: string;
}

function identity(res: Response): Identity {
  return res.locals.identity as Identity;
}

/** Имя в комнате: из Telegram, у гостя — из запроса. */
function roomUser(req: Request, res: Response): RoomUser {
  const who = identity(res);
  return { userId: who.userId, name: who.name ?? normalizeName(req.body?.name) ?? GUEST_NAME };
}

function roomCode(req: Request): string {
  const code = normalizeRoomCode(req.params.id);
  if (!code) throw new RoomError(404, 'Комната не найдена. Проверьте код.');
  return code;
}

/**
 * API онлайн-комнат (G2). Синхронизация — long-polling (G1): клиент держит GET /rooms/:id?since=<version>,
 * сервер отвечает, как только версия комнаты вырастет, или 204 через POLL_TIMEOUT_MS.
 */
export function apiRouter(service: RoomService, config: ApiConfig): express.Router {
  const router = express.Router();
  router.use(express.json({ limit: '64kb' }));
  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  router.get('/config', (_req, res) => {
    const { botUsername, appShortName } = config;
    const body: ServerConfig = { telegramApp: botUsername && appShortName ? { bot: botUsername, app: appShortName } : null };
    res.json(body);
  });

  router.use('/rooms', (req, res, next) => {
    const auth = identify(req.get('authorization'), config.botToken, Math.floor(Date.now() / 1000));
    if (!auth.ok) {
      res.status(auth.status).json({ error: auth.error });
      return;
    }
    res.locals.identity = auth.identity;
    next();
  });

  router.post('/rooms', async (req, res) => {
    res.json(await service.create(roomUser(req, res), req.body?.mode, req.body?.bots));
  });

  router.get('/rooms/:id', async (req, res) => {
    const id = roomCode(req);
    const since = Number(req.query.since);
    if (!Number.isInteger(since)) {
      res.json(await service.view(id, identity(res).userId));
      return;
    }
    const abort = new AbortController();
    res.on('close', () => abort.abort());
    const view = await service.waitForChange(id, identity(res).userId, since, POLL_TIMEOUT_MS, abort.signal);
    if (res.writableEnded || abort.signal.aborted) return;
    if (view) res.json(view);
    else res.status(204).end();
  });

  router.post('/rooms/:id/join', async (req, res) => {
    res.json(await service.join(roomCode(req), roomUser(req, res)));
  });

  router.post('/rooms/:id/leave', async (req, res) => {
    const view = await service.leave(roomCode(req), identity(res).userId);
    res.json({ room: view });
  });

  router.post('/rooms/:id/config', async (req, res) => {
    res.json(await service.configure(roomCode(req), identity(res).userId, { mode: req.body?.mode, bots: req.body?.bots }));
  });

  router.post('/rooms/:id/start', async (req, res) => {
    res.json(await service.start(roomCode(req), identity(res).userId));
  });

  router.post('/rooms/:id/action', async (req, res) => {
    const action = parseAction(req.body?.action);
    if (!action) throw new RoomError(400, 'Неизвестное действие.');
    res.json(await service.act(roomCode(req), identity(res).userId, action));
  });

  router.use((_req, res) => {
    res.status(404).json({ error: 'Нет такого адреса API.' });
  });

  // Express 5 сам передаёт сюда отклонённые промисы async-обработчиков.
  router.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof RoomError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    const status = typeof error === 'object' && error !== null && 'status' in error ? Number(error.status) : 500;
    if (status >= 400 && status < 500) {
      res.status(status).json({ error: 'Неверный запрос.' });
      return;
    }
    console.error(error);
    res.status(500).json({ error: 'Сервер не справился с запросом, попробуйте ещё раз.' });
  });

  return router;
}
