import { GROUP_COLORS, TOWER_LEVEL } from '../../shared/game/board';
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
  /** 0 — без построек, 1–4 модуля, TOWER_LEVEL — небоскрёб */
  level: number;
  mortgaged: boolean;
  tokens: Player[];
  /** id фишек, которые сейчас шагают по полю: у них анимация «прыжка» */
  moving: string[];
  onClick: () => void;
}

function buildingsTitle(level: number): string {
  if (level >= TOWER_LEVEL) return 'небоскрёб';
  return `модулей: ${level}`;
}

export function Cell({ cell, row, col, ownerColor, level, mortgaged, tokens, moving, onClick }: Props) {
  const stripe = cell.kind === 'district' ? GROUP_COLORS[cell.group] : undefined;
  const title = [cell.name, level > 0 && buildingsTitle(level), mortgaged && 'в залоге'].filter(Boolean).join(' · ');
  return (
    <button
      className={`cell cell-${cell.kind}${mortgaged ? ' mortgaged' : ''}`}
      style={{ gridRow: row, gridColumn: col, borderColor: ownerColor }}
      onClick={onClick}
      title={title}
    >
      {stripe && <span className="cell-stripe" style={{ background: stripe }} />}
      {level > 0 && (
        <span className="cell-buildings">
          {level >= TOWER_LEVEL ? (
            <span className="tower" />
          ) : (
            Array.from({ length: level }, (_, i) => <span key={i} className="module" />)
          )}
        </span>
      )}
      {ICONS[cell.kind] && <span className="cell-icon">{ICONS[cell.kind]}</span>}
      <span className="cell-name">{cell.short}</span>
      {ownerColor && <span className="cell-owner" style={{ background: ownerColor }} />}
      {tokens.length > 0 && (
        <span className="tokens">
          {tokens.map((p) => (
            <span
              key={p.id}
              className={['token', p.isolation && 'isolated', moving.includes(p.id) && 'hop'].filter(Boolean).join(' ')}
              style={{ background: p.color }}
              title={p.isolation ? `${p.name} в Изоляторе` : p.name}
            />
          ))}
        </span>
      )}
    </button>
  );
}
