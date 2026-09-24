import { haptic, type HapticKind } from './telegram';

/** Игровые события, у которых есть звук и вибрация. */
export type Cue =
  | 'dice'
  | 'step'
  | 'jump'
  | 'buy'
  | 'coin'
  | 'pay'
  | 'card'
  | 'bid'
  | 'turn'
  | 'bankrupt'
  | 'win'
  | 'lose';

interface Tone {
  /** Гц; to — плавный сдвиг частоты к концу тона */
  freq: number;
  to?: number;
  /** начало и длительность, с */
  at: number;
  dur: number;
  type: OscillatorType;
  gain: number;
}

const blip = (freq: number, at: number, dur = 0.06, type: OscillatorType = 'square', gain = 0.05): Tone => ({ freq, at, dur, type, gain });

/** Звуки синтезируются на лету: короткие неоновые «бипы», без аудиофайлов. */
const SOUNDS: Record<Cue, Tone[]> = {
  dice: [blip(420, 0), blip(610, 0.07), blip(350, 0.14), blip(540, 0.21), blip(300, 0.29, 0.09)],
  step: [blip(880, 0, 0.035, 'triangle', 0.035)],
  jump: [{ freq: 900, to: 300, at: 0, dur: 0.35, type: 'sawtooth', gain: 0.05 }],
  buy: [blip(660, 0, 0.08, 'triangle', 0.07), blip(990, 0.08, 0.14, 'triangle', 0.07)],
  coin: [blip(1320, 0, 0.05, 'triangle', 0.06), blip(1760, 0.05, 0.12, 'triangle', 0.06)],
  pay: [{ freq: 520, to: 260, at: 0, dur: 0.22, type: 'triangle', gain: 0.07 }],
  card: [{ freq: 300, to: 1200, at: 0, dur: 0.18, type: 'sine', gain: 0.06 }],
  bid: [blip(740, 0, 0.05, 'triangle', 0.05)],
  turn: [blip(520, 0, 0.07, 'sine', 0.06), blip(780, 0.08, 0.1, 'sine', 0.06)],
  bankrupt: [{ freq: 400, to: 90, at: 0, dur: 0.6, type: 'sawtooth', gain: 0.06 }],
  win: [blip(523, 0, 0.12, 'triangle', 0.07), blip(659, 0.12, 0.12, 'triangle', 0.07), blip(784, 0.24, 0.12, 'triangle', 0.07), blip(1047, 0.36, 0.3, 'triangle', 0.07)],
  lose: [blip(392, 0, 0.18, 'sine', 0.07), blip(330, 0.18, 0.18, 'sine', 0.07), blip(262, 0.36, 0.4, 'sine', 0.07)],
};

const HAPTICS: Record<Cue, HapticKind> = {
  dice: { type: 'impact', style: 'medium' },
  step: { type: 'selection' },
  jump: { type: 'notification', style: 'warning' },
  buy: { type: 'notification', style: 'success' },
  coin: { type: 'impact', style: 'light' },
  pay: { type: 'notification', style: 'warning' },
  card: { type: 'impact', style: 'light' },
  bid: { type: 'selection' },
  turn: { type: 'impact', style: 'medium' },
  bankrupt: { type: 'notification', style: 'error' },
  win: { type: 'notification', style: 'success' },
  lose: { type: 'notification', style: 'error' },
};

const KEY = 'cyber-rent:sound';
let enabled = readEnabled();
const listeners = new Set<() => void>();
let audio: AudioContext | null = null;

function readEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

/** Звук и вибрация включены (переключатель 🔊 в игре). */
export function soundEnabled(): boolean {
  return enabled;
}

export function setSoundEnabled(value: boolean): void {
  enabled = value;
  try {
    localStorage.setItem(KEY, value ? 'on' : 'off');
  } catch {
    // хранилище недоступно — настройка действует до перезагрузки
  }
  listeners.forEach((listener) => listener());
}

/** Для useSyncExternalStore. */
export function subscribeSound(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function context(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null;
  audio ??= new AudioContext();
  // Браузер разрешает звук только после жеста пользователя; до него resume() просто не сработает.
  if (audio.state === 'suspended') audio.resume().catch(() => undefined);
  return audio;
}

/** Первый же тап по странице «размораживает» звук, чтобы ходы ботов тоже были слышны. */
export function unlockAudioOnGesture(): void {
  const unlock = () => {
    if (enabled) context();
    window.removeEventListener('pointerdown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
}

/** Звук события и, если vibrate, вибрация в Telegram. */
export function playCue(cue: Cue, vibrate = true): void {
  if (!enabled) return;
  if (vibrate) haptic(HAPTICS[cue]);
  const ctx = context();
  if (!ctx || ctx.state !== 'running') return;
  const start = ctx.currentTime + 0.01;
  for (const tone of SOUNDS[cue]) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const t0 = start + tone.at;
    const t1 = t0 + tone.dur;
    osc.type = tone.type;
    osc.frequency.setValueAtTime(tone.freq, t0);
    if (tone.to) osc.frequency.exponentialRampToValueAtTime(tone.to, t1);
    gain.gain.setValueAtTime(tone.gain, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t1);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t1 + 0.02);
  }
}
