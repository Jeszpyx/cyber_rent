import path from 'node:path';
import express from 'express';
import { webhookCallback } from 'grammy';
import { apiRouter, type ApiConfig } from './api';
import { createGameBot, setupGameBot, WEBHOOK_PATH, webhookSecret } from './bot';
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
// Публичный https-адрес сайта: на него ставится вебхук и кнопка меню бота
const APP_URL = process.env.APP_URL?.replace(/\/+$/, '');
const rooms = new RoomService(createStore(DATABASE_URL));
const apiConfig: ApiConfig = { botToken: BOT_TOKEN, botUsername: BOT_USERNAME, appShortName: APP_SHORT_NAME };

// Бот работает только на вебхуке: под iisnode нет постоянно живого процесса для long polling
const botConfig = BOT_TOKEN && APP_URL?.startsWith('https://') ? { token: BOT_TOKEN, appUrl: APP_URL } : null;
const bot = botConfig ? createGameBot(botConfig) : null;

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    node: process.version,
    startedAt,
    storage: rooms.storage,
    telegramAuth: Boolean(BOT_TOKEN),
    bot: bot?.isInited() ? `@${bot.botInfo.username}` : null,
  });
});

if (bot && botConfig) {
  app.post(WEBHOOK_PATH, express.json(), webhookCallback(bot, 'express', { secretToken: webhookSecret(botConfig.token) }));
}

app.use('/api', apiRouter(rooms, apiConfig));

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
  if (!bot || !botConfig) {
    console.log('Бот выключен: нужны BOT_TOKEN и APP_URL (https://...).');
    return;
  }
  setupGameBot(bot, botConfig)
    .then(() => {
      // username для ссылок-приглашений берём у Telegram, если он не задан явно
      apiConfig.botUsername ??= bot.botInfo.username;
      console.log(`Бот @${bot.botInfo.username} готов, вебхук ${APP_URL}${WEBHOOK_PATH}`);
    })
    .catch((error: unknown) => console.error('Бот не запустился:', error));
});
