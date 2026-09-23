import { GROUP_COLORS } from '../../shared/game/board';
import type { Cell as CellData, Player } from '../../shared/game/types';

const ICONS: Partial<Record<CellData['kind'], string>> = {
  start: '➜',
  transit: '🚝',
  utility: '⚡',
  tax: '₵',
  hack: '⌨',
  net: '⌬',
  isolation: '⛓',
  goToIsolation: '🚨',
  neutral: '☯',
};

interface Props {
  cell: CellData;
  row: number;
  col: number;
  ownerColor?: string;
  tokens: Player[];
  onClick: () => void;
}

export function Cell({ cell, row, col, ownerColor, tokens, onClick }: Props) {
  const stripe = cell.kind === 'district' ? GROUP_COLORS[cell.group] : undefined;
  return (
    <button
      className={`cell cell-${cell.kind}`}
      style={{ gridRow: row, gridColumn: col, borderColor: ownerColor }}
      onClick={onClick}
      title={cell.name}
    >
      {stripe && <span className="cell-stripe" style={{ background: stripe }} />}
      {ICONS[cell.kind] && <span className="cell-icon">{ICONS[cell.kind]}</span>}
      <span className="cell-name">{cell.short}</span>
      {ownerColor && <span className="cell-owner" style={{ background: ownerColor }} />}
      {tokens.length > 0 && (
        <span className="tokens">
          {tokens.map((p) => (
            <span
              key={p.id}
              className={p.isolation ? 'token isolated' : 'token'}
              style={{ background: p.color }}
              title={p.isolation ? `${p.name} в Изоляторе` : p.name}
            />
          ))}
        </span>
      )}
    </button>
  );
}
