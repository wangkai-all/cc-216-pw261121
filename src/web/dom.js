// 极简 DOM 构造辅助
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return el;
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

export function toast(message, kind = '') {
  const el = h('div', { class: `toast ${kind}` }, message);
  document.body.append(el);
  setTimeout(() => el.remove(), 4200);
}

export function fmtWall(iso, tz) {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function statusPill(status) {
  const map = {
    COMPLETE: ['green', '完整'],
    MISSING_ALIGHT: ['amber', '缺下车'],
    ORPHAN_ALIGHT: ['red', '孤儿下车'],
    PENDING: ['amber', '待处理'],
    ASSUMED: ['purple', '约定补扣'],
  };
  const [cls, label] = map[status] || ['blue', status];
  return h('span', { class: `pill ${cls}` }, label);
}
