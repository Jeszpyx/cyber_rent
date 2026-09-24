import { useEffect, useRef } from 'react';
import type { GameState } from '../../shared/game/types';
import { playCue, type Cue } from '../feedback';

/**
 * Главное событие между двумя состояниями — по одному звуку на изменение, по убыванию важности.
 * vibrate — событие касается человека (вибрация только тогда).
 */
function cueBetween(prev: GameState, next: GameState, humanId: string): { cue: Cue; vibrate: boolean } | null {
  if (next.phase === 'gameOver' && prev.phase !== 'gameOver') {
    return { cue: next.winnerId === humanId ? 'win' : 'lose', vibrate: true };
  }
  const broke = next.players.find((p, i) => p.bankrupt && !prev.players[i].bankrupt);
  if (broke) return { cue: 'bankrupt', vibrate: broke.id === humanId };
  if (next.phase === 'card' && prev.phase !== 'card') return { cue: 'card', vibrate: next.players[next.currentPlayer].id === humanId };
  const bought = Object.keys(next.owners).find((i) => prev.owners[Number(i)] === undefined);
  if (bought !== undefined) return { cue: 'buy', vibrate: next.owners[Number(bought)] === humanId };
  if (next.auction && prev.auction && next.auction.bid !== prev.auction.bid) return { cue: 'bid', vibrate: false };

  const human = next.players.find((p) => p.id === humanId);
  const before = prev.players.find((p) => p.id === humanId);
  if (human && before && human.money !== before.money) {
    return { cue: human.money > before.money ? 'coin' : 'pay', vibrate: true };
  }
  const turnPassed = next.currentPlayer !== prev.currentPlayer || next.round !== prev.round;
  if (turnPassed && next.players[next.currentPlayer].id === humanId) return { cue: 'turn', vibrate: true };
  return null;
}

/** Звук и вибрация по изменениям партии; пока идёт анимация хода, события копятся до её конца. */
export function useGameSounds(state: GameState, busy: boolean, humanId: string): void {
  const heard = useRef(state);

  useEffect(() => {
    if (busy || heard.current === state) return;
    const event = cueBetween(heard.current, state, humanId);
    heard.current = state;
    if (event) playCue(event.cue, event.vibrate);
  }, [state, busy, humanId]);
}
