// 页面 6：分析结果导出（明确标注为分析数据，非真实扣款）
import { h } from '../dom.js';
import { toast } from '../dom.js';
import { downloadJson, downloadText } from '../storage.js';
import { activePolicy } from '../app-state.js';
import { toCsv } from '../../core/csv.js';
import { fmtYuan } from '../../core/money.js';

export function viewExport(state) {
  const result = state.lastResult;
  if (!result) return h('div', { class: 'panel' }, h('p', { class: 'muted' }, '暂无计算结果，请先导入数据'));
  const policy = activePolicy(state);

  const buildAnalysis = () => ({
    exportKind: 'FARE_ANALYSIS_ONLY',
    disclaimer: '本文件为票价规则回放的分析结果，所有卡号与线路为虚构数据，不构成真实扣款，不连接支付系统。',
    generatedAt: new Date().toISOString(),
    businessTimezone: policy.timezone,
    policy: { id: policy.id, name: policy.name, missingAlight: policy.missingAlight },
    totals: result.totals,
    cards: result.cards.map(c => ({
      cardId: c.cardId,
      tripCount: c.tripCount,
      billedCount: c.billedCount,
      pendingCount: c.pendingCount,
      baseTotalYuan: c.baseTotalCents / 100,
      finalTotalYuan: c.finalTotalCents / 100,
      discountTotalYuan: c.discountTotalCents / 100,
    })),
    trips: result.trips.map(t => ({
      tripId: t.tripId,
      cardId: t.cardId,
      routeId: t.routeId,
      status: t.status,
      boardTs: t.boardTs,
      alightTs: t.alightTs,
      businessDay: t.dayKey,
      weekBucket: t.weekKey,
      baseFareYuan: t.baseFareCents === null ? null : t.baseFareCents / 100,
      finalFareYuan: t.finalFareCents === null ? null : t.finalFareCents / 100,
      discountYuan: t.discountCents === null ? null : t.discountCents / 100,
      evidence: t.evidence,
    })),
  });

  const buildCsv = () => {
    const header = ['tripId', 'cardId', 'routeId', 'status', 'boardTs', 'alightTs', 'businessDay', 'weekBucket', 'baseFareYuan', 'discountYuan', 'finalFareYuan', 'evidenceSummary'];
    const rows = [header];
    for (const t of result.trips) {
      rows.push([
        t.tripId, t.cardId, t.routeId, t.status, t.boardTs, t.alightTs || '',
        t.dayKey, t.weekKey,
        t.baseFareCents === null ? '' : t.baseFareCents / 100,
        t.discountCents === null ? '' : t.discountCents / 100,
        t.finalFareCents === null ? 'PENDING' : t.finalFareCents / 100,
        (t.evidence || []).map(e => `${e.title}${e.amountCents ? `(${e.amountCents / 100}元)` : ''}`).join(' | '),
      ]);
    }
    return toCsv(rows);
  };

  const buildDiffExport = () => {
    const run = state.history[0];
    if (!run) return null;
    return {
      exportKind: 'RECOMPUTE_DIFF_ANALYSIS',
      disclaimer: '重算差额分析，仅用于对账演练，非真实资金变动。',
      runId: run.runId,
      reason: run.reason,
      baselineRunId: run.diffs.baselineRunId,
      changedTrips: run.diffs.changedTrips,
      newTrips: run.diffs.newTrips,
      removedTrips: run.diffs.removedTrips,
      affectedPeriods: run.diffs.periodTotals,
    };
  };

  return h('div', {},
    h('div', { class: 'disclaimer' },
      '导出内容统一标注 exportKind=*_ANALYSIS_ONLY。这些是规则回放产生的分析数据，不能也不会发起任何真实支付或扣款。'),
    h('div', { class: 'panel' },
      h('h2', {}, `导出分析结果（当前方案：${policy.name}）`),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', onClick: () => { downloadJson('fare-analysis.json', buildAnalysis()); toast('已导出 JSON 分析结果', 'success'); } }, '导出完整分析 JSON'),
        h('button', { class: 'btn primary', onClick: () => { downloadText('fare-analysis.csv', buildCsv()); toast('已导出 CSV 分析结果', 'success'); } }, '导出行程明细 CSV'),
        h('button', { class: 'btn', disabled: !state.history[0], onClick: () => {
          const d = buildDiffExport();
          if (d) { downloadJson('recompute-diff.json', d); toast('已导出重算差额分析', 'success'); }
        } }, '导出最近一次重算差额 JSON'),
        h('button', { class: 'btn', onClick: () => { downloadJson('snapshot-state.json', state); toast('已导出完整工作区快照', 'success'); } }, '导出工作区快照（含规则/事件/历史）'),
      ),
    ),
    h('div', { class: 'panel' },
      h('h2', {}, '导出预览（前 10 程）'),
      h('div', { class: 'scroll-x' }, h('table', {},
        h('thead', {}, h('tr', {},
          h('th', {}, '行程'), h('th', {}, '卡号'), h('th', {}, '业务日'), h('th', {}, '周桶'),
          h('th', { class: 'num' }, '基础(元)'), h('th', { class: 'num' }, '减免(元)'), h('th', { class: 'num' }, '最终(元)'),
        )),
        h('tbody', {}, result.trips.slice(0, 10).map(t => h('tr', {},
          h('td', { class: 'mono' }, t.tripId),
          h('td', { class: 'mono' }, t.cardId),
          h('td', { class: 'mono' }, t.dayKey),
          h('td', { class: 'mono' }, t.weekKey),
          h('td', { class: 'num mono' }, t.baseFareCents === null ? '—' : fmtYuan(t.baseFareCents)),
          h('td', { class: 'num mono discount' }, t.discountCents ? fmtYuan(t.discountCents) : '—'),
          h('td', { class: 'num mono' }, t.finalFareCents === null ? '待处理' : fmtYuan(t.finalFareCents)),
        ))),
      )),
    ),
  );
}
