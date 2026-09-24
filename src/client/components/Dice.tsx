import { useEffect, useState } from 'react';

/** Точки грани на сетке 3×3 (номера ячеек слева направо, сверху вниз). */
const PIPS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};
/** Как часто меняются грани, пока кубики катятся (ms). */
const SHUFFLE_MS = 70;

const randomFaces = (): [number, number] => [1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)];

/** Пока rolling, грани мелькают случайно (только картинка — результат уже в состоянии игры). */
export function Dice({ dice, rolling }: { dice: [number, number] | null; rolling: boolean }) {
  const [faces, setFaces] = useState(randomFaces);

  useEffect(() => {
    if (!rolling) return;
    const id = setInterval(() => setFaces(randomFaces()), SHUFFLE_MS);
    return () => clearInterval(id);
  }, [rolling]);

  const shown = rolling ? faces : dice;
  const label = shown && !rolling ? `Выпало ${shown[0]} и ${shown[1]}` : 'Кубики';
  return (
    <div className={rolling ? 'dice rolling' : 'dice'} role="img" aria-label={label}>
      {(shown ?? [null, null]).map((value, i) =>
        value ? (
          <span key={i} className="die">
            {Array.from({ length: 9 }, (_, cell) => (
              <span key={cell} className={PIPS[value].includes(cell) ? 'pip' : undefined} />
            ))}
          </span>
        ) : (
          <span key={i} className="die empty">
            ?
          </span>
        ),
      )}
    </div>
  );
}
