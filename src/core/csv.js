// 最小 RFC4180 风格 CSV 解析/序列化（支持引号、逗号转义、CRLF）。

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\r') {
      // 跳过，等 \n 处理
    } else if (c === '\n') {
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.length !== 1 || r[0] !== '');
}

export function toCsv(rows) {
  return rows
    .map(row =>
      row
        .map(v => {
          const s = v === null || v === undefined ? '' : String(v);
          return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(',')
    )
    .join('\r\n');
}

/** 表头行 + 数据行 → 对象数组，支持表头别名 */
export function rowsToObjects(rows, aliases = {}) {
  const header = rows[0].map(h => aliases[h.trim()] || h.trim());
  return rows.slice(1).map(cells => {
    const obj = {};
    header.forEach((h, i) => { obj[h] = (cells[i] ?? '').trim(); });
    return obj;
  });
}
