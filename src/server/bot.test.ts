import { describe, expect, it } from 'vitest';
import type { Bot } from 'grammy';
import { createGameBot, webhookSecret } from './bot';

const APP_URL = 'https://game.example';

/** Бот без сети: botInfo задан заранее, исходящие вызовы API перехватываются. */
function testBot() {
  const bot = createGameBot({ token: '1:test', appUrl: APP_URL });
  bot.botInfo = {
    id: 1,
    is_bot: true,
    first_name: 'Cyber Rent',
    username: 'cyber_rent_bot',
    can_join_groups: false,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
    can_connect_to_business: false,
    has_main_web_app: false,
  } as Bot['botInfo'];
  const calls: { method: string; payload: Record<string, unknown> }[] = [];
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> });
    return { ok: true, result: true } as never;
  });
  return { bot, calls };
}

function message(text: string) {
  const isCommand = text.startsWith('/');
  return {
    update_id: 1,
    message: {
      message_id: 1,
      date: 0,
      chat: { id: 7, type: 'private' as const, first_name: 'Nick' },
      from: { id: 7, is_bot: false, first_name: 'Nick' },
      text,
      ...(isCommand ? { entities: [{ type: 'bot_command' as const, offset: 0, length: text.split(' ')[0]!.length }] } : {}),
    },
  };
}

function webAppUrl(payload: Record<string, unknown>): string {
  const markup = payload.reply_markup as { inline_keyboard: { web_app?: { url: string } }[][] };
  return markup.inline_keyboard[0]![0]!.web_app!.url;
}

describe('Telegram-бот', () => {
  it('/start opens the game', async () => {
    const { bot, calls } = testBot();
    await bot.handleUpdate(message('/start'));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe('sendMessage');
    expect(webAppUrl(calls[0]!.payload)).toBe(`${APP_URL}/`);
  });

  it('/start <room code> leads straight into the room', async () => {
    const { bot, calls } = testBot();
    await bot.handleUpdate(message('/start K7PX2M'));
    expect(webAppUrl(calls[0]!.payload)).toBe(`${APP_URL}/?room=K7PX2M`);
  });

  it('ignores a malformed start payload', async () => {
    const { bot, calls } = testBot();
    await bot.handleUpdate(message('/start <script>'));
    expect(webAppUrl(calls[0]!.payload)).toBe(`${APP_URL}/`);
  });

  it('answers any other text with the play button', async () => {
    const { bot, calls } = testBot();
    await bot.handleUpdate(message('привет'));
    expect(webAppUrl(calls[0]!.payload)).toBe(`${APP_URL}/`);
  });

  it('derives a webhook secret Telegram accepts', () => {
    expect(webhookSecret('1:test')).toMatch(/^[A-Za-z0-9_-]{1,256}$/);
    expect(webhookSecret('1:test')).not.toBe(webhookSecret('2:test'));
  });
});
