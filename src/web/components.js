// 共享展示组件：统计卡、证据链展开、行程表
import { h } from './dom.js';
import { fmtYuan } from '../core/money.js';
import { fmtWall, statusPill } from './dom.js';

const EV_STYLE = {
  TRANSFER: ['discount', '换乘减免'],
  DAILY_CAP: ['cap', '日封顶调整'],
  WEEKLY_CAP: ['cap', '周封顶调整'],
  FARE: ['', '基础票价'],
  ASSUMED_FARE: ['cap', '约定补扣'],
  PENDING: ['', '待处理'],
  ANOMALY: ['cap', '异常'],
};

export function evidenceDetails(trip, tz) {
  const items = (trip.evidence || []).map(ev => {
    const [cls, label] = EV_STYLE[ev.ruleType] || ['', ev.ruleType];
    const amount = ev.amountCents
      ? h('span', { class: `ev-amount ${ev.action === 'DISCOUNT' || ev.action === 'CAP_ADJUST' ? 'discount' : ''}` },
          `${ev.action === 'DISCOUNT' || ev.action === 'CAP_ADJUST' ? '−' : '+'}${fmtYuan(ev.amountCents)}`)
      : null;
    return h('li', {},
      h('div', {}, h('span', { class: 'ev-title' }, ev.title || label), amount),
      h('div', { class: 'ev-detail' }, ev.detail || ''),
      ev.ruleId ? h('div', { class: 'ev-detail mono' }, `规则ID: ${ev.ruleId}${ev.refs ? ' · ' + JSON.stringify(ev.refs) : ''}`) : null,
    );
  });
  return h('details', { class: 'evidence' },
    h('summary', {}, `展开 ${items.length} 条计价依据（优惠 / 封顶累计）`),
    h('ul', { class: 'ev-list' }, items),
  );
}

export function statCard(label, value, sub) {
  return h('div', { class: 'stat' },
    h('div', { class: 'label' }, label),
    h('div', { class: 'value' }, value),
    sub ? h('div', { class: 'sub' }, sub) : null,
  );
}

export function totalsGrid(totals) {
  return h('div', { class: 'grid cols-4' },
    statCard('行程总数', totals.tripCount, `计费 ${totals.billedCount} · 待处理 ${totals.pendingCount}`),
    statCard('基础票价合计', fmtYuan(totals.baseTotalCents), '未应用任何优惠'),
    statCard('优惠/封顶减免', fmtYuan(totals.discountTotalCents), '换乘折扣 + 封顶调整'),
    statCard('最终分析扣费合计', fmtYuan(totals.finalTotalCents), '分析结果，非真实扣款'),
  );
}

export function tripTable(trips, tz, opts = {}) {
  if (!trips.length) return h('p', { class: 'muted' }, '暂无行程');
  const headerExtra = opts.compareCols || [];
  return h('div', { class: 'scroll-x' },
    h('table', {},
      h('thead', {}, h('tr', {},
        h('th', {}, '行程'),
        h('th', {}, '卡号 / 线路'),
        h('th', {}, '上车（业务时区）'),
        h('th', {}, '下车'),
        h('th', {}, '状态'),
        ...headerExtra.map(c => h('th', { class: 'num' }, c)),
        h('th', { class: 'num' }, '基础票价'),
        h('th', { class: 'num' }, '减免'),
        h('th', { class: 'num' }, '最终分析扣费'),
        h('th', {}, '依据'),
      )),
      h('tbody', {}, trips.map(t => h('tr', {},
        h('td', { class: 'mono' }, t.tripId),
        h('td', {}, h('div', { class: 'mono' }, t.cardId), h('div', { class: 'muted mono' }, t.routeId)),
        h('td', { class: 'mono' }, fmtWall(t.boardTs, tz)),
        h('td', { class: 'mono' }, t.alightTs ? fmtWall(t.alightTs, tz) : '—'),
        h('td', {}, statusPill(t.billed === false ? (t.basis === 'PENDING' ? 'PENDING' : t.status) : t.status)),
        ...(opts.compareCells ? opts.compareCells(t) : []),
        h('td', { class: 'num mono' }, t.baseFareCents === null ? '—' : fmtYuan(t.baseFareCents)),
        h('td', { class: 'num mono discount' }, t.discountCents ? `−${fmtYuan(t.discountCents)}` : '—'),
        h('td', { class: 'num mono' }, t.finalFareCents === null ? '待处理' : fmtYuan(t.finalFareCents)),
        h('td', {}, evidenceDetails(t, tz)),
      ))),
    ),
  );
}

export function cardAccordion(cards, tz) {
  return h('div', {}, cards.map(c => h('details', { class: 'panel', open: cards.length <= 3 },
    h('summary', { style: 'cursor:pointer;font-weight:600' },
      `${c.cardId} · ${c.tripCount} 程（计费 ${c.billedCount} / 待处理 ${c.pendingCount}） · 合计 ${fmtYuan(c.finalTotalCents)}（减免 ${fmtYuan(c.discountTotalCents)}）`),
    h('div', { class: 'grid cols-2', style: 'margin-top:12px' },
      h('div', {},
        h('h3', {}, '日累计（业务日，按上车时刻归桶）'),
        spendTable(c.daySpend, 'day'),
      ),
      h('div', {},
        h('h3', {}, '周累计（周桶键为周起始日）'),
        spendTable(c.weekSpend, 'week'),
      ),
    ),
    h('div', { style: 'margin-top:12px' }, tripTable(c.trips, tz)),
  )));
}

function spendTable(rows, kind) {
  if (!rows.length) return h('p', { class: 'muted' }, '无');
  return h('table', {},
    h('thead', {}, h('tr', {}, h('th', {}, kind === 'day' ? '业务日' : '周起始日'), h('th', { class: 'num' }, '当日/周累计分析扣费'))),
    h('tbody', {}, rows.map(r => h('tr', {},
      h('td', { class: 'mono' }, r[kind]),
      h('td', { class: 'num mono' }, fmtYuan(r.cents)),
    ))),
  );
}
