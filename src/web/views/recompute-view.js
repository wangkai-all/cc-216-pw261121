// 页面 4：重算与差额（快照历史、离线补传/撤销演示、受影响日/周周期）
import { h } from '../dom.js';
import { toast } from '../dom.js';
import { applyBackfill, applyCancel, recomputeWithActivePolicy } from '../app-state.js';
import { fmtYuan } from '../../core/money.js';
import { fmtWall } from '../dom.js';

export function viewRecompute(state, rerender) {
  const tz = state.policyA.timezone;
  const hasBackfill = state.events.some(e => e.eventId === 'EV-0012');
  const hasCancel = state.events.some(e => e.eventType === 'CANCEL' && e.cancelEventId === 'EV-B01');
  const latest = state.history[0];

  return h('div', {},
    h('div', { class: 'panel' },
      h('h2', {}, '重算触发场景（基于当前事件全集，历史快照永不覆盖）'),
      h('div', { class: 'row' },
        h('button', {
          class: 'btn primary', disabled: hasBackfill,
          onClick: () => { const { run } = applyBackfill(state); toast(`补传完成：${run.diffs.changedTrips.length} 笔扣费变化，差额已保留`, 'success'); rerender(); },
        }, hasBackfill ? '✓ 补传事件已存在' : '模拟离线补传 CARD-1002 下车记录'),
        h('button', {
          class: 'btn primary', disabled: hasCancel,
          onClick: () => { const { run } = applyCancel(state); toast(`撤销完成：受影响 ${run.affectedCards.join(', ')}，换乘优惠已重算`, 'success'); rerender(); },
        }, hasCancel ? '✓ 撤销事件已存在' : '模拟撤销 CARD-1003 首程刷卡'),
        h('button', { class: 'btn', onClick: () => { recomputeWithActivePolicy(state, '手动触发全量重算'); toast('已基于当前规则重算', 'success'); rerender(); } }, '手动全量重算'),
      ),
      h('p', { class: 'muted' },
        '补传：迟到的 ALIGHT 使缺下车行程闭合，约定补扣额与实际票价的差额被记录；撤销：CANCEL 事件使原刷卡失效，受影响卡号的当日/当周封顶与后续换乘资格全部重算。'),
    ),

    latest ? diffPanel(latest, tz) : h('div', { class: 'panel' }, h('p', { class: 'muted' }, '暂无计算记录')),

    h('div', { class: 'panel' },
      h('h2', {}, `计算快照历史（保留最近 ${state.history.length} 次，仅追加不覆盖）`),
      h('div', { class: 'scroll-x' }, h('table', {},
        h('thead', {}, h('tr', {},
          h('th', {}, '运行 ID'), h('th', {}, '时间'), h('th', {}, '触发原因'),
          h('th', {}, '受影响卡号'), h('th', { class: 'num' }, '基础合计'),
          h('th', { class: 'num' }, '最终分析扣费'), h('th', { class: 'num' }, '差额笔数'),
        )),
        h('tbody', {}, state.history.map(run => h('tr', {},
          h('td', { class: 'mono' }, run.runId),
          h('td', { class: 'mono' }, fmtWall(run.ts, tz)),
          h('td', {}, h('span', { class: `pill ${run.reason.kind === 'CANCEL' ? 'red' : run.reason.kind === 'BACKFILL' ? 'cyan' : 'blue'}` }, run.reason.kind), ' ', run.reason.note || ''),
          h('td', { class: 'mono' }, (run.affectedCards || []).join(', ') || '—'),
          h('td', { class: 'num mono' }, fmtYuan(run.totals.baseTotalCents)),
          h('td', { class: 'num mono' }, fmtYuan(run.totals.finalTotalCents)),
          h('td', { class: 'num mono' }, String(run.diffs?.changedTrips?.length ?? 0)),
        ))),
      )),
    ),
  );
}

function diffPanel(run, tz) {
  const d = run.diffs;
  return h('div', { class: 'panel' },
    h('h2', {}, `最近一次重算差额（${run.runId}，对比基线 ${d.baselineRunId || '无（首次计算）'}）`),
    h('div', { class: 'grid cols-3' },
      h('div', { class: 'stat' }, h('div', { class: 'label' }, '扣费变化行程'), h('div', { class: 'value' }, String(d.changedTrips.length)), h('div', { class: 'sub' }, '同物理行程前后扣费不同')),
      h('div', { class: 'stat' }, h('div', { class: 'label' }, '新增 / 消失行程'), h('div', { class: 'value' }, `${d.newTrips.length} / ${d.removedTrips.length}`), h('div', { class: 'sub' }, '不伪造差额，单独列示')),
      h('div', { class: 'stat' }, h('div', { class: 'label' }, '差额合计（新-旧）'),
        h('div', { class: `value ${sumDelta(d) > 0 ? 'diff-pos' : 'diff-neg'}` }, fmtYuan(sumDelta(d))),
        h('div', { class: 'sub' }, '正=补收，负=退回，均为分析值')),
    ),
    changedTable(d.changedTrips, tz),
    newRemovedTable('新增行程（补传后出现或转为计费）', d.newTrips, tz),
    newRemovedTable('消失行程（撤销导致）', d.removedTrips, tz),
    periodTable('受影响业务日累计', d.periodTotals.days, tz),
    periodTable('受影响业务周累计（周起始日键）', d.periodTotals.weeks, tz),
  );
}

function sumDelta(d) {
  return d.changedTrips.reduce((s, t) => s + t.deltaCents, 0);
}

function changedTable(rows, tz) {
  if (!rows.length) return h('p', { class: 'muted' }, '无扣费变化');
  return h('div', { class: 'scroll-x', style: 'margin-top:12px' }, h('table', {},
    h('thead', {}, h('tr', {},
      h('th', {}, '行程'), h('th', {}, '卡号/线路'), h('th', {}, '上车时间'),
      h('th', { class: 'num' }, '原扣费'), h('th', { class: 'num' }, '新扣费'),
      h('th', { class: 'num' }, '差额'), h('th', {}, '原因'),
    )),
    h('tbody', {}, rows.map(t => h('tr', {},
      h('td', { class: 'mono' }, t.tripId),
      h('td', {}, h('div', { class: 'mono' }, t.cardId), h('div', { class: 'muted mono' }, t.routeId)),
      h('td', { class: 'mono' }, fmtWall(t.boardTs, tz)),
      h('td', { class: 'num mono' }, t.oldFinalCents === null ? '待处理' : fmtYuan(t.oldFinalCents)),
      h('td', { class: 'num mono' }, t.newFinalCents === null ? '待处理' : fmtYuan(t.newFinalCents)),
      h('td', { class: `num mono ${t.deltaCents > 0 ? 'diff-pos' : 'diff-neg'}` }, `${t.deltaCents > 0 ? '+' : ''}${fmtYuan(t.deltaCents)}`),
      h('td', { class: 'muted' }, t.reason),
    ))),
  ));
}

function newRemovedTable(title, rows, tz) {
  if (!rows.length) return null;
  return h('div', { style: 'margin-top:14px' },
    h('h3', {}, `${title}（${rows.length}）`),
    h('table', {}, h('tbody', {}, rows.map(t => h('tr', {},
      h('td', { class: 'mono' }, t.tripId), h('td', { class: 'mono' }, t.cardId),
      h('td', { class: 'mono' }, t.routeId), h('td', { class: 'mono' }, fmtWall(t.boardTs, tz)),
      h('td', { class: 'mono' }, t.status),
      h('td', { class: 'num mono' }, t.finalFareCents === null ? '待处理' : fmtYuan(t.finalFareCents)),
    )))),
  );
}

function periodTable(title, rows, tz) {
  if (!rows.length) return null;
  return h('div', { style: 'margin-top:14px' },
    h('h3', {}, `${title}（${rows.length}）`),
    h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, '卡号'), h('th', {}, '周期键'), h('th', { class: 'num' }, '最新累计分析扣费'))),
      h('tbody', {}, rows.map(r => h('tr', {},
        h('td', { class: 'mono' }, r.cardId), h('td', { class: 'mono' }, r.period),
        h('td', { class: 'num mono' }, fmtYuan(r.cents)),
      ))),
    ),
  );
}
