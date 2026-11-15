// 业务时区工具：所有“日/周”边界按选定业务时区的墙钟时间计算，
// 而换乘时长等“经过时间”按绝对时刻计算。

const dtfCache = new Map();

function getFormatter(tz) {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    dtfCache.set(tz, f);
  }
  return f;
}

const WEEKDAY_INDEX = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 0 };

/**
 * 返回事件在业务时区下的墙钟部件。
 * { year, month, day, hour, minute, second, dow(0=周日..6=周六) }
 */
export function wallParts(iso, tz) {
  const inst = new Date(iso);
  if (Number.isNaN(inst.getTime())) throw new Error(`非法时间: ${iso}`);
  const parts = {};
  for (const p of getFormatter(tz).formatToParts(inst)) {
    if (p.type !== 'literal') parts[p.type] = p.value;
  }
  // 某些环境午夜小时返回 "24"，归一化为 0
  const hour = Number(parts.hour) === 24 ? 0 : Number(parts.hour);
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour,
    minute: Number(parts.minute),
    second: Number(parts.second),
    dow: WEEKDAY_INDEX[parts.weekday],
  };
}

/** 业务时区下的日期键 YYYY-MM-DD */
export function businessDate(iso, tz) {
  const p = wallParts(iso, tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** 业务时区下的本地墙钟字符串 YYYY-MM-DDTHH:mm，用于生效时间比较 */
export function wallLocalString(iso, tz) {
  const p = wallParts(iso, tz);
  return `${businessDate(iso, tz)}T${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

/**
 * 周桶键：该日期所在周的周一（或配置的周起始日）日期。
 * weekStartsOn: 0=周日, 1=周一 ... 6=周六
 */
export function weekBucket(dateStr, weekStartsOn = 1) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=周日
  let diff = dow - weekStartsOn;
  if (diff < 0) diff += 7;
  const start = new Date(Date.UTC(y, m - 1, d) - diff * 86400000);
  return start.toISOString().slice(0, 10);
}

/** 两个绝对时刻之间经过的分钟数（a 相对 b） */
export function elapsedMinutes(fromIso, toIso) {
  return (new Date(toIso).getTime() - new Date(fromIso).getTime()) / 60000;
}

/**
 * 规则是否在某墙钟时刻生效。
 * effectiveFrom/effectiveTo 为业务时区墙钟 'YYYY-MM-DDTHH:mm'，空串表示不限。
 */
export function isActiveAt(rule, wallLocal) {
  const t = wallLocal.slice(0, 16);
  if (rule.effectiveFrom && t < rule.effectiveFrom) return false;
  if (rule.effectiveTo && t > rule.effectiveTo) return false;
  return true;
}

/**
 * 把导入的生效时间统一成业务时区墙钟字符串。
 * 带 Z/偏移的绝对时间先换算；不带时区的视为已是业务时区墙钟。
 */
export function normalizeEffective(value, tz) {
  if (value === undefined || value === null || value === '') return '';
  const s = String(value).trim();
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)) {
    return wallLocalString(s, tz);
  }
  // 已经是本地墙钟，允许 YYYY-MM-DD 或 YYYY-MM-DDTHH:mm
  return s.length === 10 ? `${s}T00:00` : s.slice(0, 16);
}
