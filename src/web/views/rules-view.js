// 页面 2：规则编辑（方案 A/B 切换，票价规则 + 优惠规则 + 缺下车策略 + 时区/周界）
import { h, toast } from '../dom.js';
import { recomputeWithActivePolicy } from '../app-state.js';

export function viewRules(state, rerender) {
  const which = state.activePolicy;
  const p = which === 'B' ? state.policyB : state.policyA;
  // 未保存标记挂在 state 上，按方案分别记录，重渲染不丢失
  if (!state._dirtyFlags) state._dirtyFlags = { A: false, B: false };
  const markDirty = () => { state._dirtyFlags[which] = true; };

  return h('div', {},
    h('div', { class: 'panel' },
      h('div', { class: 'row', style: 'justify-content:space-between' },
        h('h2', { style: 'margin:0' }, '候选规则方案'),
        h('div', { class: 'mode-switch' },
          h('button', { class: which === 'A' ? 'active' : '', onClick: () => { state.activePolicy = 'A'; rerender(); } }, '方案 A'),
          h('button', { class: which === 'B' ? 'active' : '', onClick: () => { state.activePolicy = 'B'; rerender(); } }, '方案 B'),
        ),
      ),
      h('div', { class: 'grid cols-3', style: 'margin-top:14px' },
        labelInput('方案名称', p.name, v => { p.name = v; markDirty(); }),
        labelInput('方案 ID', p.id, v => { p.id = v; markDirty(); }),
        labelSelect('业务时区', p.timezone, [
          ['Asia/Shanghai', 'Asia/Shanghai（中国标准时间）'],
          ['Asia/Urumqi', 'Asia/Urumqi（乌鲁木齐时间）'],
          ['UTC', 'UTC'],
        ], v => { p.timezone = v; markDirty(); }),
        labelSelect('每周起始日', String(p.weekStartsOn), [['1', '周一'], ['0', '周日'], ['6', '周六']],
          v => { p.weekStartsOn = Number(v); markDirty(); }),
      ),
      h('h3', {}, '缺少下车记录策略（不能假设行程完整）'),
      h('div', { class: 'row' },
        h('label', { class: 'mode-switch' },
          h('button', { class: p.missingAlight.mode === 'PENDING' ? 'active' : '', onClick: () => { p.missingAlight.mode = 'PENDING'; markDirty(); rerender(); } }, 'PENDING：进入待处理，不计费'),
          h('button', { class: p.missingAlight.mode === 'DEFAULT_FARE' ? 'active' : '', onClick: () => { p.missingAlight.mode = 'DEFAULT_FARE'; markDirty(); rerender(); } }, 'DEFAULT_FARE：约定补扣'),
        ),
        p.missingAlight.mode === 'DEFAULT_FARE'
          ? labelInput('约定补扣额（元，留空 = 该线路最高档票价）', p.missingAlight.assumedFareYuan ?? '', v => { p.missingAlight.assumedFareYuan = v === '' ? null : Number(v); markDirty(); }, 'number')
          : h('p', { class: 'muted' }, '待处理行程不计费、不参与封顶累计、不作为换乘依据，待补全下车记录后重算。'),
      ),
      h('div', { class: 'row', style: 'margin-top:14px' },
        h('button', { class: 'btn primary', onClick: () => { recomputeWithActivePolicy(state, `方案 ${which} 规则编辑后重算`); state._dirtyFlags[which] = false; toast(`方案 ${which} 已保存并重算`, 'success'); rerender(); } }, '保存并重算'),
        h('button', { class: 'btn', onClick: () => {
          const other = which === 'A' ? buildCopy(state.policyB) : buildCopy(state.policyA);
          if (which === 'A') state.policyA = other; else state.policyB = other;
          toast('已从另一套方案复制（需保存才生效）', 'warn'); rerender();
        } }, '从另一套方案复制'),
        state._dirtyFlags[which] ? h('span', { class: 'pill amber' }, '有未保存修改') : h('span', { class: 'muted' }, '修改后请点击“保存并重算”'),
      ),
    ),

    farePanel(p, markDirty, rerender),
    discountPanel(p, markDirty, rerender),
    routeStopsPanel(p, markDirty),
  );
}

function buildCopy(src) {
  const c = JSON.parse(JSON.stringify(src));
  c.id = `${src.id}-copy`;
  c.name = `${src.name}（副本）`;
  return c;
}

function labelInput(label, value, onInput, type = 'text') {
  return h('label', { class: 'field' }, label,
    h('input', { value: value ?? '', type, onInput: e => onInput(e.target.value) }));
}
function labelSelect(label, value, options, onChange) {
  return h('label', { class: 'field' }, label,
    h('select', { onChange: e => onChange(e.target.value) },
      options.map(([v, t]) => h('option', { value: v, selected: String(v) === String(value) ? true : undefined }, t))));
}

function farePanel(p, markDirty, rerender) {
  const cards = p.fareRules.map((r, idx) => h('div', { class: 'rule-card' },
    h('div', { class: 'rule-head' },
      h('strong', {}, `票价规则 ${idx + 1}：${r.routeId} · ${r.type === 'FLAT' ? '一票制' : '里程计价'}`),
      h('button', { class: 'btn small danger', onClick: () => { p.fareRules.splice(idx, 1); markDirty(); rerender(); } }, '删除'),
    ),
    h('div', { class: 'grid cols-3' },
      labelInput('规则 ID', r.id, v => { r.id = v; markDirty(); }),
      labelInput('线路 ID', r.routeId, v => { r.routeId = v; markDirty(); }),
      labelSelect('计价方式', r.type, [['FLAT', '一票制 FLAT'], ['DISTANCE', '里程 DISTANCE']], v => { r.type = v; markDirty(); rerender(); }),
      r.type === 'FLAT'
        ? labelInput('一票制票价（元）', r.flatFareYuan, v => { r.flatFareYuan = Number(v); markDirty(); }, 'number')
        : null,
      labelInput('生效自（业务时区墙钟，留空不限）', r.effectiveFrom || '', v => { r.effectiveFrom = v; markDirty(); }, 'datetime-local'),
      labelInput('生效止（留空不限）', r.effectiveTo || '', v => { r.effectiveTo = v; markDirty(); }, 'datetime-local'),
    ),
    r.type === 'DISTANCE' ? tierEditor(r, markDirty, rerender) : null,
  ));

  return h('div', { class: 'panel' },
    h('h2', {}, '线路票价规则（同线路多条生效时取最近生效的一条）'),
    cards,
    h('button', { class: 'btn', onClick: () => {
      p.fareRules.push({ id: `FR-NEW-${p.fareRules.length + 1}`, routeId: 'BUS-XX', type: 'FLAT', flatFareYuan: 2, tiers: [], effectiveFrom: '', effectiveTo: '' });
      markDirty(); rerender();
    } }, '＋ 新增票价规则'),
  );
}

function tierEditor(r, markDirty, rerender) {
  if (!r.tiers) r.tiers = [];
  return h('div', {},
    h('h3', {}, '里程档位（按乘车站数匹配最小适用 maxStops）'),
    h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, '最大站数 maxStops'), h('th', {}, '票价（元）'), h('th', {}))),
      h('tbody', {}, r.tiers.map((t, i) => h('tr', {},
        h('td', h('input', { value: t.maxStops, type: 'number', onInput: e => { t.maxStops = Number(e.target.value); markDirty(); } })),
        h('td', h('input', { value: t.fareYuan, type: 'number', step: '0.01', onInput: e => { t.fareYuan = Number(e.target.value); markDirty(); } })),
        h('td', h('button', { class: 'btn small danger', onClick: () => { r.tiers.splice(i, 1); markDirty(); rerender(); } }, '删除')),
      ))),
    ),
    h('button', { class: 'btn small', onClick: () => { r.tiers.push({ maxStops: 10, fareYuan: 3 }); markDirty(); rerender(); } }, '＋ 新增档位'),
  );
}

const TYPE_LABEL = { TRANSFER: '换乘优惠', DAILY_CAP: '日封顶', WEEKLY_CAP: '周封顶' };

function discountPanel(p, markDirty, rerender) {
  const sorted = [...p.discountRules].sort((a, b) => a.priority - b.priority);
  const cards = sorted.map(r => {
    const realIdx = p.discountRules.indexOf(r);
    return h('div', { class: 'rule-card' },
      h('div', { class: 'rule-head' },
        h('strong', {}, `${TYPE_LABEL[r.type]}：${r.name || r.id}（执行顺序 priority=${r.priority}）`),
        h('div', { class: 'row' },
          h('button', { class: 'btn small', onClick: () => { r.priority -= 5; markDirty(); rerender(); } }, '↑ 提前'),
          h('button', { class: 'btn small', onClick: () => { r.priority += 5; markDirty(); rerender(); } }, '↓ 置后'),
          h('button', { class: 'btn small danger', onClick: () => { p.discountRules.splice(realIdx, 1); markDirty(); rerender(); } }, '删除'),
        ),
      ),
      h('div', { class: 'grid cols-3' },
        labelInput('规则 ID', r.id, v => { r.id = v; markDirty(); }),
        labelInput('名称', r.name, v => { r.name = v; markDirty(); }),
        labelInput('优先级 priority（小者先执行）', r.priority, v => { r.priority = Number(v); markDirty(); }, 'number'),
        labelInput('生效自', r.effectiveFrom || '', v => { r.effectiveFrom = v; markDirty(); }, 'datetime-local'),
        labelInput('生效止', r.effectiveTo || '', v => { r.effectiveTo = v; markDirty(); }, 'datetime-local'),
        r.type === 'TRANSFER' ? labelInput('换乘窗口（分钟，按绝对时刻）', r.windowMinutes, v => { r.windowMinutes = Number(v); markDirty(); }, 'number') : null,
        r.type === 'TRANSFER' ? labelSelect('减免方式', r.discountType, [['PERCENT', '百分比折扣（%）'], ['FIXED', '固定减免（元）']], v => { r.discountType = v; markDirty(); rerender(); }) : null,
        r.type === 'TRANSFER' ? labelInput(r.discountType === 'PERCENT' ? '折扣百分比（如 50 = 5 折）' : '固定减免（元）', r.discountValue, v => { r.discountValue = Number(v); markDirty(); }, 'number') : null,
        r.type === 'TRANSFER' ? labelInput('封顶折扣上限（元，留空不限）', r.maxDiscountYuan ?? '', v => { r.maxDiscountYuan = v === '' ? null : Number(v); markDirty(); }, 'number') : null,
        r.type === 'TRANSFER' ? labelSelect('是否仅限同线路换乘', String(Boolean(r.sameRouteOnly)), [['false', '不限线路'], ['true', '仅限同线路']], v => { r.sameRouteOnly = v === 'true'; markDirty(); }) : null,
        r.type !== 'TRANSFER' ? labelInput(`${TYPE_LABEL[r.type]}金额（元）`, r.capYuan, v => { r.capYuan = Number(v); markDirty(); }, 'number') : null,
      ),
    );
  });

  return h('div', { class: 'panel' },
    h('h2', {}, '优惠与封顶规则（按 priority 从小到大依次执行，顺序即扣费顺序）'),
    h('p', { class: 'muted' }, '默认顺序：换乘优惠(10) → 日封顶(20) → 周封顶(30)。封顶只在累计超额时对当程做调整，不产生负扣费。'),
    cards,
    h('div', { class: 'row' },
      h('button', { class: 'btn', onClick: () => { p.discountRules.push(newDiscount('TRANSFER', p.discountRules.length)); markDirty(); rerender(); } }, '＋ 换乘规则'),
      h('button', { class: 'btn', onClick: () => { p.discountRules.push(newDiscount('DAILY_CAP', p.discountRules.length)); markDirty(); rerender(); } }, '＋ 日封顶'),
      h('button', { class: 'btn', onClick: () => { p.discountRules.push(newDiscount('WEEKLY_CAP', p.discountRules.length)); markDirty(); rerender(); } }, '＋ 周封顶'),
    ),
  );
}

function newDiscount(type, n) {
  const base = { id: `DR-NEW-${n + 1}`, type, name: TYPE_LABEL[type], effectiveFrom: '', effectiveTo: '' };
  if (type === 'TRANSFER') return { ...base, priority: 10, windowMinutes: 90, discountType: 'PERCENT', discountValue: 50, maxDiscountYuan: null, sameRouteOnly: false };
  if (type === 'DAILY_CAP') return { ...base, priority: 20, capYuan: 15 };
  return { ...base, priority: 30, capYuan: 60 };
}

function routeStopsPanel(p, markDirty) {
  const text = JSON.stringify(p.routeStops || {}, null, 2);
  return h('div', { class: 'panel' },
    h('h2', {}, '线路站序（里程计价依据）'),
    h('p', { class: 'muted' }, 'JSON 格式：{ "线路ID": { "站点ID": 站序整数 } }'),
    h('textarea', { rows: 8, onInput: e => {
      try { p.routeStops = JSON.parse(e.target.value); markDirty(); e.target.style.borderColor = ''; }
      catch { e.target.style.borderColor = 'var(--red)'; }
    } }, text),
  );
}
