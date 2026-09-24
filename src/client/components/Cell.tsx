import type { CSSProperties } from 'react';
import { GROUP_COLORS, TOWER_LEVEL, isOwnable } from '../../shared/game/board';
import type { Cell as CellData, Player } from '../../shared/game/types';
import { cellIcon } from '../cellIcons';
import type { CellSide } from '../hooks/useBoardLayout';

interface Props {
  cell: CellData;
  row: number;
  col: number;
  /** сторона поля: цветная планка с ценой лежит на внешнем крае клетки */
  side: CellSide;
  ownerColor?: string;
  /** цвет игрока, чья фишка сейчас ходит и стоит на этой клетке */
  activeColor?: string;
  /** 0 — без построек, 1–4 модуля, TOWER_LEVEL — небоскрёб */
  level: number;
  mortgaged: boolean;
  /** подпись вместо названия, например копилка Нейтральной зоны */
  note?: string;
  tokens: Player[];
  /** id фишек, которые сейчас шагают по полю: у них анимация «прыжка» */
  moving: string[];
  onClick: () => void;
}

function buildingsTitle(level: number): string {
  if (level >= TOWER_LEVEL) return 'небоскрёб';
  return `модулей: ${level}`;
}

/** Текст на цветной планке: цена покупки или сумма налога. */
function bandText(cell: CellData): string | null {
  if (isOwnable(cell)) return `${cell.price}`;
  if (cell.kind === 'tax') return `−${cell.amount}`;
  return null;
}

export function Cell({ cell, row, col, side, ownerColor, activeColor, level, mortgaged, note, tokens, moving, onClick }: Props) {
  const Icon = cellIcon(cell);
  const band = bandText(cell);
  const special = !isOwnable(cell) && cell.kind !== 'tax';
  const title = [cell.name, level > 0 && buildingsTitle(level), mortgaged && 'в залоге', note && `копилка ${note}`]
    .filter(Boolean)
    .join(' · ');
  const classes = ['cell', `cell-${cell.kind}`, `side-${side}`];
  if (ownerColor) classes.push('owned');
  if (mortgaged) classes.push('mortgaged');
  if (activeColor) classes.push('active');
  const style = {
    gridRow: row,
    gridColumn: col,
    '--group': cell.kind === 'district' ? GROUP_COLORS[cell.group] : undefined,
    '--owner': ownerColor,
    '--active': activeColor,
  } as CSSProperties;

  return (
    <button className={classes.join(' ')} style={style} onClick={onClick} title={title} aria-label={title}>
      {band && <span className="cell-band">{band}</span>}
      <span className="cell-body">
        {level > 0 && (
          <span className="cell-buildings" aria-hidden>
            {level >= TOWER_LEVEL ? (
              <span className="tower" />
            ) : (
              Array.from({ length: level }, (_, i) => <span key={i} className="module" />)
            )}
          </span>
        )}
        <Icon className="cell-icon" aria-hidden strokeWidth={1.75} />
        {special ? (
          <span className="cell-label">{note ?? cell.short}</span>
        ) : (
          <span className="cell-name">{cell.short}</span>
        )}
      </span>
      {tokens.length > 0 && (
        <span className="tokens">
          {tokens.map((p) => (
            <span
              key={p.id}
              className={['token', p.isolation && 'isolated', moving.includes(p.id) && 'hop'].filter(Boolean).join(' ')}
              style={{ '--pc': p.color } as CSSProperties}
              title={p.isolation ? `${p.name} в Изоляторе` : p.name}
            />
          ))}
        </span>
      )}
    </button>
  );
}
