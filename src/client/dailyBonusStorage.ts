import type { DailyBonusRecord } from '../shared/game/dailyBonus';

/** Пока нет сервера (блок G), ежедневный бонус хранится в localStorage этого устройства. */
const KEY = 'cyber-rent:daily-bonus';

export function loadBonusRecord(): DailyBonusRecord | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as DailyBonusRecord) : null;
  } catch {
    return null;
  }
}

export function saveBonusRecord(record: DailyBonusRecord): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(record));
  } catch {
    // хранилище недоступно (приватный режим) — бонус просто не запомнится
  }
}

/** Сегодняшняя дата по местному времени, 'YYYY-MM-DD'. */
export function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
