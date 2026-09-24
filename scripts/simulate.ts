/**
 * Проверка баланса: партии бот-против-ботов (все игроки ходят через decideBotAction).
 * Запуск: npm run simulate [-- <партий> <ботов> <режим>], по умолчанию 1000 партий по 4 игрока в «Классике».
 */
import { decideBotAction } from '../src/shared/game/bot';
import { applyAction, createGame } from '../src/shared/game/engine';
import { MODES, type GameModeId } from '../src/shared/game/modes';

/** Столько ходов — и партия считается ничьей (без победителя). */
const MAX_TURNS = 1000;

const games = Number(process.argv[2] ?? 1000);
const bots = Number(process.argv[3] ?? 3);
const players = bots + 1;
const mode = (process.argv[4] ?? 'classic') as GameModeId;
if (!MODES[mode]) throw new Error(`Неизвестный режим: ${mode}. Есть: ${Object.keys(MODES).join(', ')}`);

const wins = new Array<number>(players).fill(0);
let finishedTurns = 0;
let finished = 0;
let built = 0;
let mortgaged = 0;
const started = Date.now();

for (let seed = 1; seed <= games; seed++) {
  let state = createGame({ playerName: 'Игрок', bots, seed, mode });
  let turns = 0;
  while (state.phase !== 'gameOver' && turns < MAX_TURNS) {
    const action = decideBotAction(state);
    if (!action) break;
    if (action.type === 'END_TURN') turns++;
    if (action.type === 'BUILD') built++;
    if (action.type === 'MORTGAGE') mortgaged++;
    state = applyAction(state, action);
  }
  if (state.winnerId) {
    finished++;
    finishedTurns += turns;
    wins[state.players.findIndex((p) => p.id === state.winnerId)]++;
  }
}

const pct = (n: number, of: number) => `${((100 * n) / of).toFixed(1)}%`;
console.log(`Режим: ${MODES[mode].name}. Партий: ${games}, игроков: ${players}, лимит: ${MAX_TURNS} ходов (${((Date.now() - started) / 1000).toFixed(1)} с)`);
console.log(`Завершено с победителем: ${finished} (${pct(finished, games)})`);
if (finished > 0) {
  console.log(`Средняя длина завершённой партии: ${(finishedTurns / finished).toFixed(1)} ходов (${(finishedTurns / finished / players).toFixed(1)} кругов)`);
}
console.log(`Построек за все партии: ${built}, залогов: ${mortgaged}`);
console.log('Винрейт по стартовой позиции (от всех партий):');
wins.forEach((w, i) => console.log(`  ${i + 1}-й игрок: ${w} (${pct(w, games)})`));
