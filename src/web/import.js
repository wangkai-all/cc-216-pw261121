// 刷卡事件 / 票价规则导入：支持 JSON 与 CSV，带字段校验与错误收集。
import { parseCsv, rowsToObjects } from '../core/csv.js';
import { EVENT_ALIASES } from '../core/trips.js';
import { normalizeEffective } from '../core/time.js';

const REQUIRED_EVENT_FIELDS = ['eventId', 'cardId', 'routeId', 'eventType', 'ts'];
const VALID_TYPES = new Set(['BOARD', 'ALIGHT', 'CANCEL', '上车', '下车', '撤销']);
const TYPE_MAP = { 上车: 'BOARD', 下车: 'ALIGHT', 撤销: 'CANCEL' };

export function parseEventsText(text, filename = '') {
  const trimmed = text.trim();
  const isCsv = filename.endsWith('.csv') || (!trimmed.startsWith('{') && !trimmed.startsWith('['));
  const data = isCsv ? parseCsv(text) : null;

  let objs;
  if (data) {
    if (data.length < 2) throw new Error('CSV 至少需要表头和一行数据');
    objs = rowsToObjects(data, EVENT_ALIASES);
  } else {
    const parsed = JSON.parse(text);
    objs = Array.isArray(parsed) ? parsed : parsed.events;
    if (!Array.isArray(objs)) throw new Error('JSON 需为事件数组或含 events 数组的对象');
  }

  const errors = [];
  const events = [];
  objs.forEach((o, idx) => {
    const row = idx + 2;
    let type = String(o.eventType).toUpperCase();
    if (TYPE_MAP[o.eventType]) type = TYPE_MAP[o.eventType];
    if (!VALID_TYPES.has(type) && !['BOARD', 'ALIGHT', 'CANCEL'].includes(type)) {
      errors.push(`第 ${row} 行事件类型非法: ${o.eventType}`);
      return;
    }
    // CANCEL 只依赖 cancelEventId，允许无事件时间；其余类型必须有 ts
    const required = type === 'CANCEL'
      ? REQUIRED_EVENT_FIELDS.filter(f => f !== 'ts')
      : REQUIRED_EVENT_FIELDS;
    const missing = required.filter(f => !o[f] && o[f] !== 0);
    if (missing.length) {
      errors.push(`第 ${row} 行缺少字段: ${missing.join(', ')}`);
      return;
    }
    if (type === 'CANCEL' && !o.cancelEventId) {
      errors.push(`第 ${row} 行 CANCEL 事件缺少 cancelEventId`);
      return;
    }
    if (type !== 'CANCEL' && Number.isNaN(new Date(o.ts).getTime())) {
      errors.push(`第 ${row} 行时间无法解析: ${o.ts}`);
      return;
    }
    const ts = type === 'CANCEL'
      ? (o.ts ? new Date(o.ts).toISOString() : (o.uploadedTs ? new Date(o.uploadedTs).toISOString() : new Date(0).toISOString()))
      : new Date(o.ts).toISOString();
    events.push({
      eventId: String(o.eventId),
      cardId: String(o.cardId),
      routeId: String(o.routeId),
      eventType: type,
      stopId: o.stopId ? String(o.stopId) : null,
      ts,
      uploadedTs: o.uploadedTs ? new Date(o.uploadedTs).toISOString() : ts,
      cancelEventId: o.cancelEventId ? String(o.cancelEventId) : null,
      source: o.source || 'IMPORT',
    });
  });

  // 重复 eventId：报错并丢弃重复项，保留首次出现的事件
  const seen = new Set();
  const deduped = [];
  for (const e of events) {
    if (seen.has(e.eventId)) {
      errors.push(`事件 ID 重复，已丢弃重复行: ${e.eventId}`);
      continue;
    }
    seen.add(e.eventId);
    deduped.push(e);
  }
  return { events: deduped, errors };
}

export function parsePolicyText(text, tz = 'Asia/Shanghai') {
  const obj = JSON.parse(text);
  const policy = obj.policy || obj;
  const errors = validatePolicyShape(policy);
  // 预归一化生效时间，方便表单直接编辑
  if (Array.isArray(policy.fareRules)) {
    policy.fareRules.forEach(r => {
      r.effectiveFrom = normalizeEffective(r.effectiveFrom, policy.timezone || tz);
      r.effectiveTo = normalizeEffective(r.effectiveTo, policy.timezone || tz);
    });
  }
  if (Array.isArray(policy.discountRules)) {
    policy.discountRules.forEach(r => {
      r.effectiveFrom = normalizeEffective(r.effectiveFrom, policy.timezone || tz);
      r.effectiveTo = normalizeEffective(r.effectiveTo, policy.timezone || tz);
    });
  }
  return { policy, errors };
}

function validatePolicyShape(p) {
  const errors = [];
  if (!p || typeof p !== 'object') { errors.push('方案不是有效 JSON 对象'); return errors; }
  if (!Array.isArray(p.fareRules)) errors.push('fareRules 必须是数组');
  if (!Array.isArray(p.discountRules)) errors.push('discountRules 必须是数组');
  if (p.missingAlight && !['PENDING', 'DEFAULT_FARE'].includes(p.missingAlight.mode)) {
    errors.push('missingAlight.mode 只能是 PENDING 或 DEFAULT_FARE');
  }
  (p.discountRules || []).forEach((r, i) => {
    if (!['TRANSFER', 'DAILY_CAP', 'WEEKLY_CAP'].includes(r.type)) {
      errors.push(`discountRules[${i}] 类型非法: ${r.type}`);
    }
  });
  return errors;
}
