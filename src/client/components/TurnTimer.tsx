import { useEffect, useState } from 'react';

/** Столько секунд и меньше — таймер подсвечивается. */
const WARN_SECONDS = 10;

/** Обратный отсчёт до таймаута хода; сам таймаут диспатчит useGame. */
export function TurnTimer({ deadline }: { deadline: number }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  const left = Math.max(0, Math.ceil((deadline - now) / 1000));
  return (
    <span className={left <= WARN_SECONDS ? 'turn-timer warn' : 'turn-timer'} title="Время на решение: потом штраф и ход за вас сделает бот">
      ⏱ {left} с
    </span>
  );
}
