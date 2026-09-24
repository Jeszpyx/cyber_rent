import {
  BAIL,
  BOARD,
  DOUBLES_TO_ISOLATION,
  GROUP_BUILD_COST,
  GROUP_COLORS,
  ISOLATION_ATTEMPTS,
  TOWER_LEVEL,
  TRANSIT_RENT,
  UTILITY_MULTIPLIERS,
  groupCells,
  isOwnable,
} from '../../shared/game/board';
import {
  buildCost,
  canBuild,
  canMortgage,
  canSellBuilding,
  canUnmortgage,
  gameMode,
  mortgageValue,
  rentMultiplier,
  sellBuildingResult,
  unmortgageCost,
} from '../../shared/game/economy';
import type { Action, Cell, GameState } from '../../shared/game/types';

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

function description(cell: Cell, state: GameState): string[] {
  switch (cell.kind) {
    case 'start':
      return [`За каждый проход через Старт игрок получает ${gameMode(state).salary}₵.`];
    case 'district': {
      const group = groupCells(cell.group).map((i) => BOARD[i].name).join(', ');
      return [
        `Квартал: ${group}`,
        `Модуль и небоскрёб — по ${GROUP_BUILD_COST[cell.group]}₵. Строить можно, владея всем кварталом без залогов, равномерно.`,
      ];
    }
    case 'transit':
      return [`Рента зависит от числа станций у владельца: ${TRANSIT_RENT.join(' / ')}₵.`];
    case 'utility':
      return [`Рента: сумма кубиков ×${UTILITY_MULTIPLIERS[0]}, при владении обеими — ×${UTILITY_MULTIPLIERS[1]}.`];
    case 'tax':
      return [`Игрок платит ${cell.amount}₵ — деньги уходят в копилку Нейтральной зоны.`];
    case 'hack':
    case 'net':
      return [
        'Игрок тянет верхнюю карточку колоды и выполняет её. Карточка уходит под низ колоды.',
        'Карточку освобождения из Изолятора можно оставить себе.',
      ];
    case 'isolation':
      return [
        'Здесь держат задержанных. Если просто проходите мимо — ничего не происходит.',
        `Выйти можно залогом ${BAIL}₵, карточкой освобождения или выбросив дубль (до ${ISOLATION_ATTEMPTS} попыток). После последней неудачи залог списывается сам.`,
        'Рента за свою собственность в Изоляторе по-прежнему начисляется.',
      ];
    case 'goToIsolation':
      return [
        'Игрок немедленно отправляется в Изолятор, Старт не проходит.',
        `${DOUBLES_TO_ISOLATION} дубля подряд за один ход тоже ведут в Изолятор.`,
      ];
    case 'neutral':
      return [
        'Сюда стекаются налоги, штрафы, залоги за Изолятор и штрафы за бездействие.',
        `Попавший на клетку забирает всю копилку. Сейчас в ней ${state.pot}₵.`,
      ];
  }
}

const RENT_LABELS = ['Без построек', '1 модуль', '2 модуля', '3 модуля', '4 модуля', 'Небоскрёб'];

function buildingsLabel(level: number): string {
  if (level >= TOWER_LEVEL) return 'небоскрёб';
  return level === 0 ? 'нет' : `${level} ${level === 1 ? 'модуль' : 'модуля'}`;
}

interface Props {
  state: GameState;
  index: number;
  /** Человек, который сейчас может управлять своей собственностью; null — кнопок нет */
  managerId: string | null;
  dispatch: (action: Action) => void;
  onClose: () => void;
}

export function CellCard({ state, index, managerId, dispatch, onClose }: Props) {
  const cell = BOARD[index];
  const owner = state.players.find((p) => p.id === state.owners[index]);
  const color = cell.kind === 'district' ? GROUP_COLORS[cell.group] : 'var(--accent)';
  const level = state.buildings[index] ?? 0;
  const mortgaged = Boolean(state.mortgaged[index]);
  const multiplier = rentMultiplier(state);
  const manageable = isOwnable(cell) && managerId !== null && owner?.id === managerId;

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal cell-card" style={{ borderColor: color }} onClick={(e) => e.stopPropagation()}>
        <div className="cell-card-head" style={{ background: color }}>
          <small>{KIND_LABELS[cell.kind]}</small>
          <h2>{cell.name}</h2>
        </div>
        <div className="cell-card-body">
          {isOwnable(cell) && <p className="price">Цена: {cell.price}₵</p>}
          {description(cell, state).map((line) => (
            <p key={line}>{line}</p>
          ))}
          {isOwnable(cell) && multiplier > 1 && <p className="inflation">Инфляция: вся рента ×{multiplier}.</p>}
          {cell.kind === 'district' && (
            <table className="rent-table">
              <tbody>
                {cell.rent.map((value, i) => (
                  <tr key={i} className={owner && i === level ? 'active' : undefined}>
                    <td>{RENT_LABELS[i]}</td>
                    <td>
                      {value * multiplier}₵{i === 0 && <small> (весь квартал — {value * 2 * multiplier}₵)</small>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {isOwnable(cell) && (
            <p>
              Залог: {mortgageValue(cell)}₵, выкуп {unmortgageCost(cell)}₵. На заложенной клетке рента не берётся.
            </p>
          )}
          {isOwnable(cell) && (
            <p>
              Владелец:{' '}
              {owner ? <b style={{ color: owner.color }}>{owner.name}</b> : <b>свободно</b>}
              {mortgaged && <b className="mortgaged-label"> · в залоге</b>}
            </p>
          )}
          {cell.kind === 'district' && owner && <p>Застройка: {buildingsLabel(level)}</p>}
        </div>
        {manageable && (
          <div className="cell-card-actions">
            {canBuild(state, index) && (
              <button className="btn small primary" onClick={() => dispatch({ type: 'BUILD', index })}>
                {level + 1 === TOWER_LEVEL ? 'Небоскрёб' : 'Модуль'} −{buildCost(index)}₵
              </button>
            )}
            {canSellBuilding(state, index) && (
              <button className="btn small" onClick={() => dispatch({ type: 'SELL_BUILDING', index })}>
                Продать постройку +{sellBuildingResult(state, index).refund}₵
              </button>
            )}
            {canMortgage(state, index) && (
              <button className="btn small" onClick={() => dispatch({ type: 'MORTGAGE', index })}>
                Заложить +{mortgageValue(cell)}₵
              </button>
            )}
            {canUnmortgage(state, index) && (
              <button className="btn small" onClick={() => dispatch({ type: 'UNMORTGAGE', index })}>
                Выкупить −{unmortgageCost(cell)}₵
              </button>
            )}
          </div>
        )}
        <button className="btn" onClick={onClose}>
          Закрыть
        </button>
      </div>
    </div>
  );
}
