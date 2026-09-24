/**
 * Ежедневный бонус: заходишь каждый день — серия растёт, пропустил день — начинается заново.
 * Бонус прибавляется к стартовым деньгам следующей партии. Хранение — на стороне клиента
 * (сейчас localStorage, после блока G — сервер); здесь только чистый расчёт.
 */

/** Бонус по дню серии; после последнего значения серия продолжает давать максимум. */
export const DAILY_BONUS_STEPS = [50, 100, 150, 200, 250, 300, 500];

export interface DailyBonusRecord {
  /** день последнего получения, 'YYYY-MM-DD' */
  lastDay: string;
  /** сколько дней подряд получен бонус */
  streak: number;
  /** полученный, но ещё не потраченный в партии бонус */
  unspent: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

export function bonusForStreak(streak: number): number {
  return DAILY_BONUS_STEPS[Math.min(streak, DAILY_BONUS_STEPS.length) - 1];
}

/** Что даст бонус сегодня; null — сегодня уже получен. */
export function availableBonus(record: DailyBonusRecord | null, today: string): { streak: number; amount: number } | null {
  if (record && daysBetween(record.lastDay, today) <= 0) return null;
  const streak = record && daysBetween(record.lastDay, today) === 1 ? record.streak + 1 : 1;
  return { streak, amount: bonusForStreak(streak) };
}

/** Забрать бонус: новая запись с накопленным unspent. Сегодня уже забран — запись без изменений. */
export function claimBonus(record: DailyBonusRecord | null, today: string): DailyBonusRecord {
  const bonus = availableBonus(record, today);
  if (!bonus) return record!;
  return { lastDay: today, streak: bonus.streak, unspent: (record?.unspent ?? 0) + bonus.amount };
}

/** Бонус ушёл в стартовые деньги партии. */
export function spendBonus(record: DailyBonusRecord): DailyBonusRecord {
  return { ...record, unspent: 0 };
}
