import type { Card, CardDeck } from './types';

/** Колода «Взлом»: перемещения, штрафы и риск. */
const HACK: Card[] = [
  { id: 'hack-01', deck: 'hack', text: 'Твой ИИ-навигатор перепрошит. Двигайся на Старт.', effect: { type: 'moveTo', index: 0 } },
  { id: 'hack-02', deck: 'hack', text: 'Встреча с информатором на Проспекте Нейросети. Отправляйся туда.', effect: { type: 'moveTo', index: 24 } },
  { id: 'hack-03', deck: 'hack', text: 'Сбой маршрутизатора: автотакси везёт тебя в Квартал Голограмм.', effect: { type: 'moveTo', index: 11 } },
  { id: 'hack-04', deck: 'hack', text: 'Корпорация зовёт на закрытый приём. Отправляйся в Пентхаус Корпорации.', effect: { type: 'moveTo', index: 39 } },
  { id: 'hack-05', deck: 'hack', text: 'Взломанный проездной! Езжай на Монорельс «Юг».', effect: { type: 'moveTo', index: 5 } },
  { id: 'hack-06', deck: 'hack', text: 'Срочный заказ на окраине. Езжай на Монорельс «Север».', effect: { type: 'moveTo', index: 25 } },
  { id: 'hack-07', deck: 'hack', text: 'Глюк дополненной реальности: вернись на 3 клетки назад.', effect: { type: 'moveBy', steps: -3 } },
  { id: 'hack-08', deck: 'hack', text: 'Короткий путь через вентиляцию: продвинься на 3 клетки вперёд.', effect: { type: 'moveBy', steps: 3 } },
  { id: 'hack-09', deck: 'hack', text: 'Тебя засекли дроны безопасности. Отправляйся в Изолятор, Старт не проходишь.', effect: { type: 'goToIsolation' } },
  { id: 'hack-10', deck: 'hack', text: 'Эксплойт в тюремной системе. Сохрани карточку: она освобождает из Изолятора.', effect: { type: 'getOutOfIsolation' } },
  { id: 'hack-11', deck: 'hack', text: 'Взломанный банкомат выдал наличные. Получи 50₵.', effect: { type: 'money', amount: 50 } },
  { id: 'hack-12', deck: 'hack', text: 'Криптокошелёк старого хакера оказался не пустым. Получи 150₵.', effect: { type: 'money', amount: 150 } },
  { id: 'hack-13', deck: 'hack', text: 'Твой бот выиграл турнир по кибершахматам. Получи 100₵.', effect: { type: 'money', amount: 100 } },
  { id: 'hack-14', deck: 'hack', text: 'Штраф за превышение скорости на гироскутере. Заплати 15₵.', effect: { type: 'money', amount: -15 } },
  { id: 'hack-15', deck: 'hack', text: 'Тебя выбрали админом общего сервера. Заплати каждому игроку по 50₵.', effect: { type: 'payEachPlayer', amount: 50 } },
  { id: 'hack-16', deck: 'hack', text: 'Плановая перепрошивка собственности: 25₵ за каждый модуль и 100₵ за каждый небоскрёб.', effect: { type: 'repairs', perModule: 25, perTower: 100 } },
];

/** Колода «Сеть»: в основном деньги и события сообщества. */
const NET: Card[] = [
  { id: 'net-01', deck: 'net', text: 'Облачный бэкап восстановлен. Двигайся на Старт.', effect: { type: 'moveTo', index: 0 } },
  { id: 'net-02', deck: 'net', text: 'Ошибка банковского ИИ в твою пользу. Получи 200₵.', effect: { type: 'money', amount: 200 } },
  { id: 'net-03', deck: 'net', text: 'Счёт от риппердока за установку импланта. Заплати 50₵.', effect: { type: 'money', amount: -50 } },
  { id: 'net-04', deck: 'net', text: 'Продал старый нейрочип на барахолке. Получи 50₵.', effect: { type: 'money', amount: 50 } },
  { id: 'net-05', deck: 'net', text: 'Знакомый ИИ-адвокат должен тебе услугу. Сохрани карточку: она освобождает из Изолятора.', effect: { type: 'getOutOfIsolation' } },
  { id: 'net-06', deck: 'net', text: 'Твои логи утекли в полицию. Отправляйся в Изолятор, Старт не проходишь.', effect: { type: 'goToIsolation' } },
  { id: 'net-07', deck: 'net', text: 'Ты устроил рейв в виртуальности. Каждый игрок платит тебе 50₵ за вход.', effect: { type: 'collectFromEachPlayer', amount: 50 } },
  { id: 'net-08', deck: 'net', text: 'День рождения твоего аватара: каждый игрок дарит тебе 10₵.', effect: { type: 'collectFromEachPlayer', amount: 10 } },
  { id: 'net-09', deck: 'net', text: 'Страховка киберимплантов выплачена. Получи 100₵.', effect: { type: 'money', amount: 100 } },
  { id: 'net-10', deck: 'net', text: 'Возврат налога на трафик. Получи 20₵.', effect: { type: 'money', amount: 20 } },
  { id: 'net-11', deck: 'net', text: 'Наследство от забытой родни из облака. Получи 100₵.', effect: { type: 'money', amount: 100 } },
  { id: 'net-12', deck: 'net', text: 'Лечение вируса в нейроинтерфейсе. Заплати 100₵.', effect: { type: 'money', amount: -100 } },
  { id: 'net-13', deck: 'net', text: 'Взнос за курсы в хакерской академии. Заплати 50₵.', effect: { type: 'money', amount: -50 } },
  { id: 'net-14', deck: 'net', text: 'Консультация по кибербезопасности соседям. Получи 25₵.', effect: { type: 'money', amount: 25 } },
  { id: 'net-15', deck: 'net', text: 'Второе место в конкурсе аватаров. Получи 10₵.', effect: { type: 'money', amount: 10 } },
  { id: 'net-16', deck: 'net', text: 'Ремонт инфраструктуры района: 40₵ за каждый модуль и 115₵ за каждый небоскрёб.', effect: { type: 'repairs', perModule: 40, perTower: 115 } },
];

export const CARDS: Card[] = [...HACK, ...NET];

export const CARD_BY_ID: Record<string, Card> = Object.fromEntries(CARDS.map((c) => [c.id, c]));

export const DECK_NAMES: Record<CardDeck, string> = {
  hack: 'Взлом',
  net: 'Сеть',
};

export function deckCardIds(deck: CardDeck): string[] {
  return CARDS.filter((c) => c.deck === deck).map((c) => c.id);
}
