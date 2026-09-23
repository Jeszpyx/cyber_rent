# Cyber Rent — план и дорожная карта

Экономическая настольная игра (механика «Монополии», свой киберпанк-сеттинг): Vite + React SPA, раздаётся через Express на MonsterASP, работает как сайт и как Telegram Mini App.

## Контекст

Проект деплоится на https://cyber-rent.runasp.net через Git deploy в панели MonsterASP (Node.js SSR, iisnode).

Цель — своя игра по механике «Монополии» в киберпанк-сеттинге. Названия, валюта и тексты карточек свои, без чужих торговых марок. Игра работает и как сайт, и как Telegram Mini App (бот у пользователя уже есть), поэтому интерфейс адаптивный.

**Этап 1 (делаем сейчас):** рабочий прототип, который можно захостить, открыть из бота и сыграть против ботов: бросить кубики, походить, купить поле, заплатить ренту, открыть карточку поля. На экране видна версия сборки, чтобы проверить, что обновления из git доходят до хостинга.
**Этап 2+:** дорожная карта из маленьких шагов для более слабых ИИ-агентов. Сохраняется в репозиторий как `docs/ROADMAP.md`.

## Принятые решения

- **Стек:** Express 5 + TypeScript 6 (сервер), Vite 8 + React 19 (клиент), Vitest 5 (тесты движка). Нужен **Node ≥ 22.12** (требование Vite 8 / Vitest 5). На хостинге Node 22.20, версия показывается в `/api/health`.
- **⚠ Не обновлять TypeScript до 7.x.** TS 7 — нативный Go-компилятор, запускается как `tsc.exe`, а MonsterASP запрещает запускать `.exe` при сборке (`spawnSync … tsc.exe UNKNOWN`). Нельзя и другие инструменты сборки, которые запускают нативные бинарники дочерним процессом.
- **Документация:** перед использованием API библиотеки сверяться с актуальной документацией через Context7 (скилл `context7-cli`: `npx ctx7@latest library <name> <query>` → `npx ctx7@latest docs <id> <query>`). Версии мажорные и новые, не полагаться на память.
- **Express 5:** catch-all маршрут пишется как `'/{*splat}'`, а не `'*'`.
- **TypeScript:** `moduleResolution: node/node10`, `baseUrl`, `target: es5` устарели (удалены в TS 7), не использовать. Сервер собирается с `module: nodenext` (без `"type": "module"` в package.json → CommonJS).
- **Игровая логика** — чистые функции в `src/shared/game/`, без React и Node API. На этапе 1 работает в браузере; позже тот же код переедет на сервер для мультиплеера.
- **Один корневой `package.json`, без workspaces.** Панель MonsterASP запускает `npm install && npm run build` для выбранного `package.json` и публикует всё вместе с `node_modules`.
- **Всё нужное для сборки лежит в `dependencies`, а не в `devDependencies`:** `typescript`, `vite`, `@vitejs/plugin-react` и `@types/*`. Неизвестно, ставит ли панель dev-зависимости (при `NODE_ENV=production` не поставит), а без них упадёт `npm run build`. В `devDependencies` — только `vitest`.
- **Сервер компилируется в CommonJS** (`dist/server/index.js`): iisnode грузит entry через `require`, с ESM-точкой входа бывают проблемы.
- **`process.env.PORT` передаётся как есть, без `parseInt`.** Под iisnode это named pipe, а не число.
- **Валюта:** кредиты `₵`. Тема: районы мегаполиса, корпорации, монорельс, «Изолятор» вместо тюрьмы.

## Структура после этапа 1

```
package.json            # скрипты build/start/dev/test, всё в одном
tsconfig.json           # база (strict), для клиента и shared
tsconfig.server.json    # module nodenext (→ CommonJS), outDir dist/server, include src/server
vite.config.ts          # root: src/client, outDir: ../../dist/client, define __BUILD_TIME__
vitest.config.ts        # тесты в src/**/*.test.ts
src/
  shared/game/
    types.ts            # Cell, Player, GameState, Action, GameEvent
    board.ts            # 40 клеток: данные поля (названия, цены, рента, группы)
    rng.ts              # seeded RNG (mulberry32) — детерминизм для тестов и будущего сервера
    engine.ts           # createGame(), applyAction(state, action) → state (чистая)
    bot.ts              # decideBotAction(state) → Action
    engine.test.ts      # vitest
  client/
    index.html          # + <script src="https://telegram.org/js/telegram-web-app.js">
    main.tsx
    App.tsx             # экран старта (выбор 1–3 ботов) → игра
    telegram.ts         # обёртка над window.Telegram?.WebApp (ready, expand, themeParams), no-op вне Telegram
    hooks/useGame.ts    # useReducer поверх applyAction + таймер ходов ботов
    components/
      Board.tsx         # CSS grid 11×11, центр — лог/кубики
      Cell.tsx          # цветная полоска группы + короткое имя + фишки игроков
      CellCard.tsx      # модалка с деталями клетки (цена, рента, владелец)
      Dice.tsx
      PlayerPanel.tsx   # деньги, собственность, кнопки действий
      BuildInfo.tsx     # «build: <время> <commit>» мелким шрифтом
    styles.css          # неоновая тема + CSS-переменные из Telegram themeParams
  server/
    index.ts            # Express: static dist/client + SPA fallback
docs/ROADMAP.md         # дорожная карта для агентов (содержимое — раздел ниже)
```

Удалить: `server.js`, `public/`.

## Этап 1 — реализация (✅ выполнено)

### 1. Сборка и сервер
- `package.json` scripts:
  - `"build": "tsc -p tsconfig.server.json && vite build"`
  - `"start": "node dist/server/index.js"`
  - `"dev": "vite"` (клиент с HMR; серверу в dev запускаться не обязательно)
  - `"test": "vitest run"`
- `src/server/index.ts`:
  - `express.static(dist/client)`: для `/assets/*` (хэшированные файлы) `Cache-Control: public, max-age=31536000, immutable`.
  - `index.html` отдаётся с `Cache-Control: no-cache`. Иначе Telegram WebView держит старую версию, и «обновления не подтягиваются».
  - `GET /api/health` → `{ ok: true, node: process.version, startedAt }` для быстрой проверки деплоя.
  - Fallback `app.get('/{*splat}')` → `index.html`.
  - Путь к `dist/client` через `path.join(__dirname, '../client')`.
- `.gitignore`: `node_modules`, `dist`.
- `vite.config.ts`: `define: { __BUILD_TIME__: JSON.stringify(new Date().toISOString()) }`. Commit hash на хостинге может быть недоступен (неизвестно, копирует ли панель `.git` в `/.source`), поэтому основной маркер — время сборки.

### 2. Игровой движок (`src/shared/game`) — MVP-правила
- 2–4 игрока (1 человек + 1–3 бота), старт 1500₵.
- Бросок 2d6, движение по 40 клеткам; за проход «Старта» +200₵.
- Свободную собственность (район / транспорт / утилита) можно купить или отказаться (без аукциона в MVP).
- Рента: район — базовая (×2 при монополии группы); транспорт — 25/50/100/200 по числу транспортных клеток у владельца; утилиты — 4× или 10× сумма кубиков.
- Налоговые клетки: фиксированная плата.
- «Взлом» / «Сеть» (аналоги шанса и казны) в MVP: событие «клетка-заглушка» в логе, без эффекта.
- «Отправка в Изолятор» в MVP: просто перенос на клетку Изолятора, без пропуска ходов.
- Дубль → ещё один ход (без правила трёх дублей в MVP).
- Банкротство: деньги < 0 → игрок выбывает, собственность возвращается банку. Остался один — победа.
- Состояние хода: `phase: 'roll' | 'buyDecision' | 'end' | 'gameOver'`.
- Action: `ROLL`, `BUY`, `SKIP_BUY`, `END_TURN`. Каждое применение пишет события в `state.log`.
- RNG хранится в состоянии как `seed`, результат детерминирован.
- `bot.ts`: покупать, если `money − price ≥ 200`; иначе пропустить.

### 3. Клиент
- `useGame`: `useReducer(applyAction)`. Если текущий игрок — бот, `useEffect` с `setTimeout(700ms)` диспатчит `decideBotAction`, чтобы ходы ботов было видно.
- Доска: квадрат `aspect-ratio: 1`, `width: min(100vw, 100dvh − высота панели)`. На узком экране (<768px) панель под доской, на широком — справа.
- Клетки на телефоне ~30px: цветная полоска + 1–2 слова. Тап → `CellCard` с полной информацией.
- Фишки игроков — цветные кружки на клетке.
- `telegram.ts`: `WebApp.ready()`, `WebApp.expand()`, цвета из `themeParams` в CSS-переменные, `disableVerticalSwipes()` при наличии, чтобы свайп не закрывал приложение.
- Вне Telegram всё работает как обычный сайт.

### 4. Тесты движка (`engine.test.ts`)
- Проход через Старт даёт +200.
- Покупка списывает деньги и назначает владельца.
- Рента переводится владельцу; при монополии удваивается.
- Банкротство выбывает игрока; последний оставшийся → `gameOver`.
- Одинаковый seed → одинаковая партия.

### 5. Деплой и Telegram (делает пользователь)
1. `git push` → в панели **Pull latest** → **Build & publish** (Start command: `dist/server/index.js` → **Save**).
2. Проверить https://cyber-rent.runasp.net/api/health и видимое время сборки на странице.
3. Проверить, что включён HTTPS (раздел HTTPS в панели): Telegram открывает Mini App только по https.
4. В @BotFather: `/mybots` → бот → **Bot Settings → Menu Button** → URL `https://cyber-rent.runasp.net` (или `/newapp` для ссылки вида `t.me/<bot>/<app>`).
5. Открыть бота в Telegram → кнопка меню → игра.
6. Проверка обновлений: поменять текст → push → Pull + Build & publish → переоткрыть Mini App → время сборки новое.

## Проверка этапа 1

- Локально: `npm install && npm test && npm run build && npm start`, затем http://localhost:3000. Сыграть партию против 3 ботов до конца или несколько кругов. Проверить F5 на `/some/route` (SPA fallback) и `/api/health`.
- Адаптивность: DevTools, ширины 360px, 768px, 1440px. Доска не вылезает, горизонтального скролла нет.
- После деплоя — пункты 2 и 6 раздела «Деплой».

---

## Дорожная карта для агентов (→ `docs/ROADMAP.md`)

Правила для агента, которые записываются в начало файла:
- Один шаг = один PR/коммит. Не трогать файлы вне указанных без необходимости.
- Логика только в `src/shared/game` (чистые функции, без React/DOM). UI только отображает состояние и диспатчит Action.
- Каждое изменение правил сопровождается тестом в `src/shared/game/*.test.ts`. `npm test` и `npm run build` должны проходить.
- Данные (клетки, карточки, цены) — в файлах данных, не в коде логики.
- Никаких оригинальных названий и терминов «Монополии» (Monopoly, Boardwalk, Chance, Community Chest и т. п.).

### Блок A — Карточки событий
- **A1.** `src/shared/game/cards.ts`: типы `Card { id, deck: 'hack' | 'net', text, effect }`; `effect` — размеченное объединение: `money`, `moveTo`, `moveBy`, `goToIsolation`, `payEachPlayer`, `collectFromEachPlayer`, `getOutOfIsolation`, `repairs`.
- **A2.** По 16 карточек в колоды «Взлом» и «Сеть», тексты в киберпанк-теме.
- **A3.** Колоды в `GameState`: перемешать seeded RNG при создании, тянуть сверху, класть вниз.
- **A4.** Обработчики эффектов `money` / `moveTo` / `moveBy` + тесты (при `moveTo` через Старт — +200).
- **A5.** Остальные эффекты + тесты.
- **A6.** UI: модалка вытянутой карточки с кнопкой «ОК» (боты закрывают автоматически).

### Блок B — Изолятор (тюрьма)
- **B1.** `player.isolation: { turnsLeft } | null`. Три дубля подряд → в Изолятор.
- **B2.** Выход: заплатить 50₵ / выбросить дубль (до 3 попыток) / карточка освобождения. Action `PAY_BAIL`, `USE_RELEASE_CARD`.
- **B3.** Решение бота в Изоляторе.
- **B4.** UI: кнопки в панели и значок на фишке.

### Блок C — Экономика и застройка
- **C1.** Таблица ренты района: `rent[0..5]` (без построек, 1–4 «модуля», «небоскрёб»). Вынести в `board.ts`.
- **C2.** Action `BUILD` / `SELL_BUILDING`: только при монополии и равномерной застройке. Тесты.
- **C3.** Лимит построек у банка (32 модуля / 12 небоскрёбов).
- **C4.** Залог (`MORTGAGE` / `UNMORTGAGE`, +10% при выкупе). На заложенной клетке рента не берётся.
- **C5.** Банкротство перед игроком: собственность переходит кредитору, а не банку.
- **C6.** Бот: строит, когда есть монополия и запас ≥ 300₵; закладывает при нехватке.
- **C7.** UI: иконки построек на клетке, кнопки в `CellCard`.
- **C8.** Проверка баланса: скрипт `scripts/simulate.ts` прогоняет 1000 партий бот-против-ботов и печатает среднюю длину партии и винрейт по стартовой позиции.

### Блок D — Бонусы и наказания (свои механики)
- **D1.** Клетка «Нейтральная зона» (аналог стоянки): копилка налогов и штрафов, забирает попавший.
- **D2.** Штраф за бездействие / таймаут хода (для онлайна).
- **D3.** Ежедневный бонус (для Mini App, позже с сервером).
- **D4.** Лимит ходов / раундов для быстрого режима: победа по капиталу.

### Блок E — Торговля и аукцион
- **E1.** Аукцион при отказе от покупки: `START_AUCTION`, `BID`, `PASS`.
- **E2.** Боты в аукционе: ставка до `price × k`.
- **E3.** Обмен между игроками: `PROPOSE_TRADE` / `ACCEPT` / `REJECT` (деньги + клетки + карточки).
- **E4.** UI аукциона и обмена.

### Блок F — UI / UX
- **F1.** Анимация кубиков и пошаговое движение фишки.
- **F2.** Лог событий с фильтром и автоскроллом.
- **F3.** Экран «Итоги партии».
- **F4.** Сохранение партии в `localStorage`, кнопка «Продолжить».
- **F5.** Звуки + вибрация `Telegram.WebApp.HapticFeedback`.
- **F6.** Кнопки Telegram: `MainButton` для главного действия, `BackButton` для закрытия модалок.
- **F7.** Проверка вёрстки на 320px и в landscape.

### Блок G — Мультиплеер (сервер)
- **G1.** Проверить поддержку WebSocket на MonsterASP (iisnode + WebSocket в web.config). Если нет — long-polling / SSE.
- **G2.** Комнаты на сервере: `POST /api/rooms`, join по коду. Сервер хранит `GameState` и применяет `applyAction` из `src/shared`.
- **G3.** Клиент: режим «онлайн», синхронизация состояния.
- **G4.** Авторизация через Telegram `initData` (проверка HMAC на сервере с токеном бота из env). Токен не коммитить.
- **G5.** Приглашение друга ссылкой `t.me/<bot>/<app>?startapp=<roomId>`.
- **G6.** Хранилище (JSON-файл / SQLite / внешняя БД) — отдельное решение перед шагом.

### Блок H — Монетизация (после мультиплеера)
- **H1.** Косметика (скины фишек / доски) за Telegram Stars (`openInvoice`, серверная выдача).
- **H2.** Реклама / рефералка — отдельное решение.
