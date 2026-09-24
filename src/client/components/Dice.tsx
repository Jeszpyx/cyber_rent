import { useEffect, useState } from 'react';

const FACES = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
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
  return (
    <div className={rolling ? 'dice rolling' : 'dice'}>
      {(shown ?? [null, null]).map((value, i) => (
        <span key={i} className={value ? 'die' : 'die empty'}>
          {value ? FACES[value - 1] : '?'}
        </span>
      ))}
    </div>
  );
}
