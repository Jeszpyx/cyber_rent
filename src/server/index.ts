import path from 'node:path';
import express from 'express';
import { apiRouter } from './api';
import { RoomService } from './rooms';
import { createStore } from './store';

const app = express();
const clientDir = path.join(__dirname, '../client');
const indexHtml = path.join(clientDir, 'index.html');
const startedAt = new Date().toISOString();

// Настройки — из переменных окружения; .env в корне репозитория (тестовые креды) их не перекрывает.
try {
  process.loadEnvFile(path.join(__dirname, '../../.env'));
} catch {
  // .env нет — работаем только с переменными окружения
}
const { DATABASE_URL, BOT_TOKEN, BOT_USERNAME, APP_SHORT_NAME } = process.env;
const rooms = new RoomService(createStore(DATABASE_URL));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, node: process.version, startedAt, storage: rooms.storage, telegramAuth: Boolean(BOT_TOKEN) });
});

app.use('/api', apiRouter(rooms, { botToken: BOT_TOKEN, botUsername: BOT_USERNAME, appShortName: APP_SHORT_NAME }));

app.use(
  '/assets',
  express.static(path.join(clientDir, 'assets'), { immutable: true, maxAge: '1y' }),
);

app.use(express.static(clientDir, { index: false }));

// index.html must never be cached, otherwise Telegram WebView keeps serving an old build
app.get('/{*splat}', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(indexHtml);
});

// Under iisnode PORT is a named pipe, not a number
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server listening on ${port}, rooms storage: ${rooms.storage}`);
});
