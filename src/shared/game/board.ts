import type { Cell, DistrictGroup, OwnableCell } from './types';

export const START_MONEY = 1500;
export const START_SALARY = 200;
export const ISOLATION_INDEX = 10;
/** Залог за выход из Изолятора */
export const BAIL = 50;
/** Попыток выбросить дубль; после последней неудачной залог списывается принудительно */
export const ISOLATION_ATTEMPTS = 3;
/** Столько дублей подряд за ход — и игрок отправляется в Изолятор */
export const DOUBLES_TO_ISOLATION = 3;
/** Уровень застройки «небоскрёб»; 1–4 — модули */
export const TOWER_LEVEL = 5;
/** Запас построек у банка: модули и небоскрёбы */
export const BANK_MODULES = 32;
export const BANK_TOWERS = 12;
/** Цена модуля (и небоскрёба) по кварталам; продаются банку за половину */
export const GROUP_BUILD_COST: Record<DistrictGroup, number> = {
  rust: 50,
  neon: 50,
  violet: 100,
  orange: 100,
  red: 150,
  yellow: 150,
  green: 200,
  blue: 200,
};
/** Залог клетки даёт price × MORTGAGE_RATE; выкуп дороже на MORTGAGE_INTEREST_PERCENT процентов (с округлением вверх) */
export const MORTGAGE_RATE = 0.5;
export const MORTGAGE_INTEREST_PERCENT = 10;
/** Минимальная ставка на торгах и шаг повышения; победитель платит свою ставку банку */
export const AUCTION_STEP = 10;
/** Рента монорельса по числу станций у владельца */
export const TRANSIT_RENT = [25, 50, 100, 200];
/** Множитель суммы кубиков для инфраструктуры: одна клетка / обе */
export const UTILITY_MULTIPLIERS = [4, 10];

export const GROUP_COLORS: Record<DistrictGroup, string> = {
  rust: '#9b5b3a',
  neon: '#3ee6ff',
  violet: '#c04dff',
  orange: '#ff8a1f',
  red: '#ff2e5b',
  yellow: '#ffe14d',
  green: '#2eff8c',
  blue: '#3d6bff',
};

export const BOARD: Cell[] = [
  { index: 0, kind: 'start', name: 'Старт', short: 'Старт' },
  { index: 1, kind: 'district', group: 'rust', name: 'Трущобы Ржавого Дока', short: 'Док', price: 60, rent: [2, 10, 30, 90, 160, 250] },
  { index: 2, kind: 'net', name: 'Сеть', short: 'Сеть' },
  { index: 3, kind: 'district', group: 'rust', name: 'Свалка Кабелей', short: 'Свалка', price: 60, rent: [4, 20, 60, 180, 320, 450] },
  { index: 4, kind: 'tax', name: 'Налог на импланты', short: 'Налог', amount: 200 },
  { index: 5, kind: 'transit', name: 'Монорельс «Юг»', short: 'Юг', price: 200 },
  { index: 6, kind: 'district', group: 'neon', name: 'Неоновый рынок', short: 'Рынок', price: 100, rent: [6, 30, 90, 270, 400, 550] },
  { index: 7, kind: 'hack', name: 'Взлом', short: 'Взлом' },
  { index: 8, kind: 'district', group: 'neon', name: 'Лапшичная улица', short: 'Лапша', price: 100, rent: [6, 30, 90, 270, 400, 550] },
  { index: 9, kind: 'district', group: 'neon', name: 'Пиксельный переулок', short: 'Пиксель', price: 120, rent: [8, 40, 100, 300, 450, 600] },
  { index: 10, kind: 'isolation', name: 'Изолятор', short: 'Изолятор' },
  { index: 11, kind: 'district', group: 'violet', name: 'Квартал Голограмм', short: 'Голо', price: 140, rent: [10, 50, 150, 450, 625, 750] },
  { index: 12, kind: 'utility', name: 'Энергосеть', short: 'Энерго', price: 150 },
  { index: 13, kind: 'district', group: 'violet', name: 'Бульвар Дронов', short: 'Дроны', price: 140, rent: [10, 50, 150, 450, 625, 750] },
  { index: 14, kind: 'district', group: 'violet', name: 'Аркадный проспект', short: 'Аркада', price: 160, rent: [12, 60, 180, 500, 700, 900] },
  { index: 15, kind: 'transit', name: 'Монорельс «Запад»', short: 'Запад', price: 200 },
  { index: 16, kind: 'district', group: 'orange', name: 'Хаб Курьеров', short: 'Курьеры', price: 180, rent: [14, 70, 200, 550, 750, 950] },
  { index: 17, kind: 'net', name: 'Сеть', short: 'Сеть' },
  { index: 18, kind: 'district', group: 'orange', name: 'Синтетический базар', short: 'Базар', price: 180, rent: [14, 70, 200, 550, 750, 950] },
  { index: 19, kind: 'district', group: 'orange', name: 'Порт Данных', short: 'Порт', price: 200, rent: [16, 80, 220, 600, 800, 1000] },
  { index: 20, kind: 'neutral', name: 'Нейтральная зона', short: 'Нейтрал' },
  { index: 21, kind: 'district', group: 'red', name: 'Башни Хрома', short: 'Хром', price: 220, rent: [18, 90, 250, 700, 875, 1050] },
  { index: 22, kind: 'hack', name: 'Взлом', short: 'Взлом' },
  { index: 23, kind: 'district', group: 'red', name: 'Площадь Кибердеки', short: 'Дека', price: 220, rent: [18, 90, 250, 700, 875, 1050] },
  { index: 24, kind: 'district', group: 'red', name: 'Проспект Нейросети', short: 'Нейро', price: 240, rent: [20, 100, 300, 750, 925, 1100] },
  { index: 25, kind: 'transit', name: 'Монорельс «Север»', short: 'Север', price: 200 },
  { index: 26, kind: 'district', group: 'yellow', name: 'Биолаборатории', short: 'Био', price: 260, rent: [22, 110, 330, 800, 975, 1150] },
  { index: 27, kind: 'district', group: 'yellow', name: 'Квантовый квартал', short: 'Квант', price: 260, rent: [22, 110, 330, 800, 975, 1150] },
  { index: 28, kind: 'utility', name: 'Датацентр', short: 'Дата', price: 150 },
  { index: 29, kind: 'district', group: 'yellow', name: 'Клиника Имплантов', short: 'Клиника', price: 280, rent: [24, 120, 360, 850, 1025, 1200] },
  { index: 30, kind: 'goToIsolation', name: 'В Изолятор', short: 'Арест' },
  { index: 31, kind: 'district', group: 'green', name: 'Корпоративный парк', short: 'Корп', price: 300, rent: [26, 130, 390, 900, 1100, 1275] },
  { index: 32, kind: 'district', group: 'green', name: 'Небесный сад', short: 'Сад', price: 300, rent: [26, 130, 390, 900, 1100, 1275] },
  { index: 33, kind: 'net', name: 'Сеть', short: 'Сеть' },
  { index: 34, kind: 'district', group: 'green', name: 'Штаб Кибербезопасности', short: 'Штаб', price: 320, rent: [28, 150, 450, 1000, 1200, 1400] },
  { index: 35, kind: 'transit', name: 'Монорельс «Восток»', short: 'Восток', price: 200 },
  { index: 36, kind: 'hack', name: 'Взлом', short: 'Взлом' },
  { index: 37, kind: 'district', group: 'blue', name: 'Орбитальный лифт', short: 'Лифт', price: 350, rent: [35, 175, 500, 1100, 1300, 1500] },
  { index: 38, kind: 'tax', name: 'Налог на роскошь', short: 'Роскошь', amount: 100 },
  { index: 39, kind: 'district', group: 'blue', name: 'Пентхаус Корпорации', short: 'Пентхаус', price: 400, rent: [50, 200, 600, 1400, 1700, 2000] },
];

export function isOwnable(cell: Cell): cell is OwnableCell {
  return cell.kind === 'district' || cell.kind === 'transit' || cell.kind === 'utility';
}

export function groupCells(group: DistrictGroup): number[] {
  return BOARD.filter((c) => c.kind === 'district' && c.group === group).map((c) => c.index);
}
