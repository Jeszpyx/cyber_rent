const FACES = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

export function Dice({ dice }: { dice: [number, number] | null }) {
  return (
    <div className="dice">
      {(dice ?? [null, null]).map((value, i) => (
        <span key={i} className={value ? 'die' : 'die empty'}>
          {value ? FACES[value - 1] : '?'}
        </span>
      ))}
    </div>
  );
}
