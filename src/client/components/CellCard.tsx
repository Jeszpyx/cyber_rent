import { BOARD, GROUP_COLORS, START_SALARY, groupCells, isOwnable } from '../../shared/game/board';
import type { Cell, GameState } from '../../shared/game/types';

const KIND_LABELS: Record<string, string> = {
  start: 'Стартовая точка',
  district: 'Район',
  transit: 'Станция монорельса',
  utility: 'Инфраструктура',
  tax: 'Налог',
  hack: 'Карточка «Взлом»',
  net: 'Карточка «Сеть»',
  isolation: 'Изолятор',
  goToIsolation: 'Арест',
  neutral: 'Нейтральная зона',
};

function description(cell: Cell): string[] {
  switch (cell.kind) {
    case 'start':
      return [`За каждый проход через Старт игрок получает ${START_SALARY}₵.`];
    case 'district': {
      const group = groupCells(cell.group).map((i) => BOARD[i].name).join(', ');
      return [
        `Рента: ${cell.rent}₵`,
        `Рента при владении всем кварталом: ${cell.rent * 2}₵`,
        `Квартал: ${group}`,
      ];
    }
    case 'transit':
      return ['Рента зависит от числа станций у владельца: 25 / 50 / 100 / 200₵.'];
    case 'utility':
      return ['Рента: сумма кубиков ×4, при владении обеими — ×10.'];
    case 'tax':
      return [`Игрок платит ${cell.amount}₵ банку.`];
    case 'hack':
    case 'net':
      return [
        'Игрок тянет верхнюю карточку колоды и выполняет её. Карточка уходит под низ колоды.',
        'Карточку освобождения из Изолятора можно оставить себе.',
      ];
    case 'isolation':
      return ['Здесь держат задержанных. Если просто проходите мимо — ничего не происходит.'];
    case 'goToIsolation':
      return ['Игрок немедленно отправляется в Изолятор.'];
    case 'neutral':
      return ['Безопасная зона. Здесь ничего не происходит.'];
  }
}

interface Props {
  state: GameState;
  index: number;
  onClose: () => void;
}

export function CellCard({ state, index, onClose }: Props) {
  const cell = BOARD[index];
  const owner = state.players.find((p) => p.id === state.owners[index]);
  const color = cell.kind === 'district' ? GROUP_COLORS[cell.group] : 'var(--accent)';

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal cell-card" style={{ borderColor: color }} onClick={(e) => e.stopPropagation()}>
        <div className="cell-card-head" style={{ background: color }}>
          <small>{KIND_LABELS[cell.kind]}</small>
          <h2>{cell.name}</h2>
        </div>
        <div className="cell-card-body">
          {isOwnable(cell) && <p className="price">Цена: {cell.price}₵</p>}
          {description(cell).map((line) => (
            <p key={line}>{line}</p>
          ))}
          {isOwnable(cell) && (
            <p>
              Владелец:{' '}
              {owner ? <b style={{ color: owner.color }}>{owner.name}</b> : <b>свободно</b>}
            </p>
          )}
        </div>
        <button className="btn" onClick={onClose}>
          Закрыть
        </button>
      </div>
    </div>
  );
}
