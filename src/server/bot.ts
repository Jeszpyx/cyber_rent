import { createHash } from 'node:crypto';
import { Bot, InlineKeyboard, type Api } from 'grammy';
import type { BotCommand } from 'grammy/types';
import { normalizeRoomCode } from '../shared/game/room';

/** Сюда Telegram шлёт обновления; путь внутри /api, чтобы не пересечься с SPA. */
export const WEBHOOK_PATH = '/api/telegram/webhook';

const COMMANDS: BotCommand[] = [
  { command: 'play', description: 'Открыть игру' },
  { command: 'help', description: 'Как играть и звать друзей' },
];
const DESCRIPTION =
  'Cyber Rent — экономическая настольная игра в неоновом мегаполисе. Скупай районы, строй импланты-небоскрёбы, собирай ренту и разори соперников. Играй против ботов или с друзьями онлайн.';
const SHORT_DESCRIPTION = 'Экономическая настольная игра в киберпанк-мегаполисе. Играй с ботами или друзьями.';
const MENU_TEXT = 'Играть';
const HELP_TEXT = [
  '<b>Как играть</b>',
  'Бросай кубики, покупай районы и собирай ренту с тех, кто на них встал. Собери все районы одного цвета, чтобы строить и поднимать ренту. Побеждает последний, кто не обанкротился.',
  '',
  '<b>С друзьями</b>',
  'Открой игру → «Онлайн» → создай комнату → «Пригласить друга». Друг откроет ссылку и сразу окажется за твоим столом.',
].join('\n');

export interface GameBotConfig {
  token: string;
  /** https-адрес сайта, он же адрес Mini App */
  appUrl: string;
}

/** Секрет из заголовка X-Telegram-Bot-Api-Secret-Token: выводим из токена, чтобы не заводить ещё одну переменную. */
export function webhookSecret(token: string): string {
  return createHash('sha256').update(`webhook:${token}`).digest('hex');
}

/** Адрес Mini App; с кодом комнаты — сразу в неё (клиент читает ?room=). */
function gameUrl(appUrl: string, room?: string): string {
  return room ? `${appUrl}/?room=${room}` : `${appUrl}/`;
}

export function createGameBot({ token, appUrl }: GameBotConfig): Bot {
  const bot = new Bot(token);
  const playButton = (room?: string) =>
    new InlineKeyboard().webApp(room ? `Войти в комнату ${room}` : 'Играть', gameUrl(appUrl, room));

  // Приглашение без short name Mini App: t.me/<bot>?start=<код> → /start <код>.
  bot.command(['start', 'play'], async (ctx) => {
    const room = normalizeRoomCode(ctx.match);
    const text = room
      ? `Тебя позвали в комнату <b>${room}</b>. Жми кнопку — и ты за столом.`
      : 'Добро пожаловать в <b>Cyber Rent</b>! Скупай районы мегаполиса, собирай ренту и разори соперников.';
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: playButton(room ?? undefined) });
  });

  bot.command('help', (ctx) => ctx.reply(HELP_TEXT, { parse_mode: 'HTML', reply_markup: playButton() }));

  bot.on('message', async (ctx) => {
    const room = normalizeRoomCode(ctx.message.text);
    if (room) {
      await ctx.reply(`Комната <b>${room}</b>:`, { parse_mode: 'HTML', reply_markup: playButton(room) });
      return;
    }
    await ctx.reply('Игра открывается кнопкой ниже или кнопкой «Играть» слева от поля ввода.', { reply_markup: playButton() });
  });

  bot.catch((error) => console.error('Ошибка бота:', error.error));
  return bot;
}

async function syncCommands(api: Api): Promise<void> {
  const current = await api.getMyCommands();
  if (JSON.stringify(current) !== JSON.stringify(COMMANDS)) await api.setMyCommands(COMMANDS);
}

async function syncDescriptions(api: Api): Promise<void> {
  if ((await api.getMyDescription()).description !== DESCRIPTION) await api.setMyDescription(DESCRIPTION);
  if ((await api.getMyShortDescription()).short_description !== SHORT_DESCRIPTION) {
    await api.setMyShortDescription(SHORT_DESCRIPTION);
  }
}

async function syncMenuButton(api: Api, url: string): Promise<void> {
  const current = await api.getChatMenuButton();
  if (current.type === 'web_app' && current.text === MENU_TEXT && current.web_app.url === url) return;
  await api.setChatMenuButton({ menu_button: { type: 'web_app', text: MENU_TEXT, web_app: { url } } });
}

async function syncWebhook(api: Api, url: string, secret: string): Promise<void> {
  const info = await api.getWebhookInfo();
  // secret_token Telegram не возвращает. Если доставка падала (например, вебхук ставили без секрета и мы отвечали 401), ставим заново.
  if (info.url === url && !info.last_error_message) return;
  await api.setWebhook(url, { secret_token: secret, allowed_updates: ['message'] });
}

/**
 * Настройка бота при старте сервера. Под iisnode процесс перезапускается часто, поэтому
 * сначала читаем текущее состояние и пишем только то, что изменилось (set* методы Telegram ограничивает по частоте).
 */
export async function setupGameBot(bot: Bot, { token, appUrl }: GameBotConfig): Promise<void> {
  await bot.init();
  const { api } = bot;
  const steps: [string, () => Promise<void>][] = [
    ['вебхук', () => syncWebhook(api, `${appUrl}${WEBHOOK_PATH}`, webhookSecret(token))],
    ['кнопка меню', () => syncMenuButton(api, gameUrl(appUrl))],
    ['команды', () => syncCommands(api)],
    ['описание', () => syncDescriptions(api)],
  ];
  for (const [name, step] of steps) {
    try {
      await step();
    } catch (error) {
      console.error(`Бот @${bot.botInfo.username}: не удалось обновить ${name}:`, error);
    }
  }
}
