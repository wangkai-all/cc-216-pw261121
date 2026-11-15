// 页面 5：两套候选规则对同一批出行的对比
import { h } from '../dom.js';
import { toast } from '../dom.js';
import { runComparison } from '../app-state.js';
import { fmtYuan } from '../../core/money.js';
import { fmtWall, statusPill } from '../dom.js';
import { evidenceDetails } from '../components.js';

export function viewCompare(state, rerender) {
  const cmp = state.comparison;
  const tz = state.policyA.timezone;

  return h('div', {},
    h('div', { class: 'panel' },
      h('h2', {}, '方案对比：同一批出行 × 两套规则'),
      h('div', { class: 'grid cols-2' },
        h('div', { class: 'stat' }, h('div', { class: 'label' }, '方案 A'), h('div', { class: 'value', style: 'font-size:16px' }, state.policyA.name),
          h('div', { class: 'sub' }, `缺下车：${state.policyA.missingAlight.mode} · 换乘窗口 ${state.policyA.discountRules.find(r => r.type === 'TRANSFER')?.windowMinutes ?? '—'} 分钟`)),
        h('div', { class: 'stat' }, h('div', { class: 'label' }, '方案 B'), h('div', { class: 'value', style: 'font-size:16px' }, state.policyB.name),
          h('div', { class: 'sub' }, `缺下车：${state.policyB.missingAlight.mode} · 换乘窗口 ${state.policyB.discountRules.find(r => r.type === 'TRANSFER')?.windowMinutes ?? '—'} 分钟`)),
      ),
      h('div', { class: 'row', style: 'margin-top:12px' },
        h('button', { class: 'btn primary', onClick: () => { runComparison(state); toast('对比计算完成', 'success'); rerender(); } }, '运行对比计算'),
      ),
    ),
    cmp ? summaryCards(cmp) : h('div', { class: 'panel' }, h('p', { class: 'muted' }, '点击“运行对比计算”查看结果')),
    cmp ? diffTable(cmp, tz) : null,
  );
}

function summaryCards(cmp) {
  const { totals } = cmp;
  return h('div', { class: 'panel' },
    h('div', { class: 'grid cols-4' },
      h('div', { class: 'stat' }, h('div', { class: 'label' }, 'A 最终分析扣费'), h('div', { class: 'value' }, fmtYuan(totals.finalA))),
      h('div', { class: 'stat' }, h('div', { class: 'label' }, 'B 最终分析扣费'), h('div', { class: 'value' }, fmtYuan(totals.finalB))),
      h('div', { class: 'stat' }, h('div', { class: 'label' }, '总额差（B − A）'),
        h('div', { class: `value ${totals.diffCents > 0 ? 'diff-pos' : 'diff-neg'}` }, `${totals.diffCents > 0 ? '+' : ''}${fmtYuan(totals.diffCents)}`),
        h('div', { class: 'sub' }, '正=B 方案多收，负=B 方案少收')),
      h('div', { class: 'stat' }, h('div', { class: 'label' }, '存在差异的行程'),
        h('div', { class: 'value' }, String(cmp.rows.filter(r => r.diffCents !== 0 || r.finalA !== r.finalB).length)),
        h('div', { class: 'sub' }, `共对比 ${cmp.rows.length} 个物理行程`)),
    ),
  );
}

function diffTable(cmp, tz) {
  return h('div', { class: 'panel' },
    h('h2', {}, '逐程对比（点击展开各方案下的计价依据）'),
    h('div', { class: 'scroll-x' }, h('table', {},
      h('thead', {}, h('tr', {},
        h('th', {}, '行程 / 卡号 / 线路'), h('th', {}, '上车时间'), h('th', {}, '状态'),
        h('th', { class: 'num' }, 'A 基础'), h('th', { class: 'num' }, 'A 最终'),
        h('th', { class: 'num' }, 'B 基础'), h('th', { class: 'num' }, 'B 最终'),
        h('th', { class: 'num' }, '差额 B−A'), h('th', {}, '依据对比'),
      )),
      h('tbody', {}, cmp.rows.map(r => {
        const changed = r.diffCents !== 0 || r.finalA !== r.finalB;
        return h('tr', { style: changed ? 'background:rgba(210,153,34,.07)' : '' },
          h('td', {}, h('div', { class: 'mono' }, r.tripId), h('div', { class: 'muted mono' }, `${r.cardId} · ${r.routeId}`)),
          h('td', { class: 'mono' }, fmtWall(r.boardTs, tz)),
          h('td', {}, statusPill(r.status)),
          h('td', { class: 'num mono' }, r.baseA === null ? '—' : fmtYuan(r.baseA)),
          h('td', { class: 'num mono' }, r.finalA === null ? '待处理' : fmtYuan(r.finalA)),
          h('td', { class: 'num mono' }, r.baseB === null ? '—' : fmtYuan(r.baseB)),
          h('td', { class: 'num mono' }, r.finalB === null ? '待处理' : fmtYuan(r.finalB)),
          h('td', { class: `num mono ${r.diffCents > 0 ? 'diff-pos' : r.diffCents < 0 ? 'diff-neg' : ''}` },
            r.diffCents === 0 ? '0.00' : `${r.diffCents > 0 ? '+' : ''}${fmtYuan(r.diffCents)}`),
          h('td', {},
            h('details', {}, h('summary', { class: 'muted', style: 'cursor:pointer' }, 'A 依据'), r.tripA ? evidenceDetails(r.tripA, tz) : h('span', { class: 'muted' }, '无')),
            h('details', {}, h('summary', { class: 'muted', style: 'cursor:pointer' }, 'B 依据'), r.tripB ? evidenceDetails(r.tripB, tz) : h('span', { class: 'muted' }, '无')),
          ),
        );
      })),
    )),
  );
}
