// 页面 3：行程回放（按用户/时间还原可计费行程，展开每笔优惠与封顶依据）
import { h } from '../dom.js';
import { activePolicy, currentReconstruction } from '../app-state.js';
import { totalsGrid, cardAccordion, tripTable } from '../components.js';

export function viewReplay(state, rerender) {
  const policy = activePolicy(state);
  const tz = policy.timezone;
  const result = state.lastResult;
  const { anomalies } = currentReconstruction(state);

  if (!result) return h('div', { class: 'panel' }, h('p', { class: 'muted' }, '请先导入数据或载入示例'));

  const cardFilter = state._cardFilter || '__ALL__';
  const visibleTrips = cardFilter === '__ALL__'
    ? result.trips
    : result.trips.filter(t => t.cardId === cardFilter);

  return h('div', {},
    h('div', { class: 'panel' },
      h('div', { class: 'row', style: 'justify-content:space-between' },
        h('h2', { style: 'margin:0' }, `行程回放 · ${policy.name}`),
        h('div', { class: 'row' },
          h('span', { class: 'muted' }, '筛选卡号'),
          h('select', { style: 'width:auto', onChange: e => { state._cardFilter = e.target.value; rerender(); } },
            h('option', { value: '__ALL__', selected: cardFilter === '__ALL__' ? true : undefined }, '全部卡号'),
            result.cards.map(c => h('option', { value: c.cardId, selected: cardFilter === c.cardId ? true : undefined }, c.cardId)),
          ),
        ),
      ),
      h('p', { class: 'muted', style: 'margin-bottom:0' },
        `业务时区 ${tz} · 周起始 ${policy.weekStartsOn === 1 ? '周一' : policy.weekStartsOn === 0 ? '周日' : '周六'} · 缺下车策略 ${policy.missingAlight.mode === 'PENDING' ? '待处理' : '约定补扣'} · 日/周桶以上车时刻归桶，跨午夜与周界不切断行程`),
    ),

    h('div', { class: 'panel' }, totalsGrid(result.totals)),

    anomalies.length ? h('div', { class: 'panel' },
      h('h2', {}, `数据异常（${anomalies.length}）`),
      h('ul', { class: 'ev-list' }, anomalies.map(a => h('li', {},
        h('span', { class: 'pill red' }, a.type),
        ` 卡 ${a.cardId} · ${a.message}`,
      ))),
    ) : null,

    h('div', { class: 'panel' },
      h('h2', {}, '按用户还原的可计费行程'),
      cardFilter === '__ALL__'
        ? cardAccordion(result.cards, tz)
        : h('div', {}, tripTable(visibleTrips, tz)),
    ),
  );
}
