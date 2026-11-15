// 计费引擎：纯函数，不依赖 DOM，可直接在 Node 下测试。
// 管线顺序由规则 priority 显式决定（小者先执行），默认：换乘 10 → 日封顶 20 → 周封顶 30。
// 金额内部统一用“分”。

import { toCents, clampCents } from './money.js';
import {
  businessDate,
  weekBucket,
  wallLocalString,
  elapsedMinutes,
  isActiveAt,
  normalizeEffective,
} from './time.js';

export const DEFAULT_POLICY = {
  id: 'policy-a',
  name: '基准方案',
  timezone: 'Asia/Shanghai',
  weekStartsOn: 1, // 周一
  missingAlight: {
    mode: 'DEFAULT_FARE', // PENDING | DEFAULT_FARE
    assumedFareYuan: null, // null = 该线路最高档票价
  },
  fareRules: [
    {
      id: 'FR-BUS01',
      routeId: 'BUS-01',
      type: 'FLAT',
      flatFareYuan: 2,
      effectiveFrom: '',
      effectiveTo: '',
    },
  ],
  discountRules: [
    {
      id: 'DR-TRANSFER',
      type: 'TRANSFER',
      name: '90 分钟内换乘优惠',
      priority: 10,
      windowMinutes: 90,
      discountType: 'PERCENT', // PERCENT | FIXED
      discountValue: 50, // 百分比或元
      maxDiscountYuan: null,
      sameRouteOnly: false,
      effectiveFrom: '',
      effectiveTo: '',
    },
    {
      id: 'DR-DAILY-CAP',
      type: 'DAILY_CAP',
      name: '日封顶',
      priority: 20,
      capYuan: 15,
      effectiveFrom: '',
      effectiveTo: '',
    },
    {
      id: 'DR-WEEKLY-CAP',
      type: 'WEEKLY_CAP',
      name: '周封顶',
      priority: 30,
      capYuan: 60,
      effectiveFrom: '',
      effectiveTo: '',
    },
  ],
  // 线路站点顺序，里程计价用：routeId -> { stopId: 站序(从1开始) }
  routeStops: {},
};

export function clonePolicy(p) {
  return JSON.parse(JSON.stringify(p));
}

/** 规范化方案：元转分、生效时间统一为业务时区墙钟 */
export function normalizePolicy(raw, tz = raw.timezone || 'Asia/Shanghai') {
  const p = clonePolicy(raw);
  p.timezone = p.timezone || tz;
  p.weekStartsOn = Number(p.weekStartsOn ?? 1);
  p.missingAlight = {
    mode: p.missingAlight?.mode === 'PENDING' ? 'PENDING' : 'DEFAULT_FARE',
    assumedFareYuan: p.missingAlight?.assumedFareYuan ?? null,
  };
  p.routeStops = p.routeStops || {};

  p.fareRules = (p.fareRules || []).map(r => ({
    ...r,
    flatFareCents: r.type === 'FLAT' ? toCents(r.flatFareYuan) : 0,
    tiers: (r.tiers || []).map(t => ({ ...t, fareCents: toCents(t.fareYuan) })),
    effectiveFrom: normalizeEffective(r.effectiveFrom, p.timezone),
    effectiveTo: normalizeEffective(r.effectiveTo, p.timezone),
  }));

  p.discountRules = (p.discountRules || []).map(r => {
    const out = { ...r, priority: Number(r.priority ?? 100) };
    out.effectiveFrom = normalizeEffective(r.effectiveFrom, p.timezone);
    out.effectiveTo = normalizeEffective(r.effectiveTo, p.timezone);
    if (r.type === 'TRANSFER') {
      out.windowMinutes = Number(r.windowMinutes);
      out.discountValue = Number(r.discountValue);
      out.maxDiscountCents = (r.maxDiscountYuan === null || r.maxDiscountYuan === undefined || r.maxDiscountYuan === '')
        ? null
        : toCents(r.maxDiscountYuan);
      out.sameRouteOnly = Boolean(r.sameRouteOnly);
    }
    if (r.type === 'DAILY_CAP' || r.type === 'WEEKLY_CAP') {
      out.capCents = toCents(r.capYuan);
    }
    return out;
  }).sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));

  return p;
}

/** 选出某线路在指定墙钟时刻生效的票价规则（多条生效取最近生效的一条） */
export function findFareRule(policy, routeId, wallLocal) {
  const candidates = policy.fareRules.filter(
    r => r.routeId === routeId && isActiveAt(r, wallLocal)
  );
  if (!candidates.length) return null;
  candidates.sort((a, b) => (b.effectiveFrom || '').localeCompare(a.effectiveFrom || ''));
  return candidates[0];
}

function routeMaxFareCents(rule) {
  if (rule.type === 'FLAT') return rule.flatFareCents;
  if (!rule.tiers.length) return 0;
  return Math.max(...rule.tiers.map(t => t.fareCents));
}

/** 计算单程基础票价（未应用优惠） */
export function baseFare(trip, policy) {
  const tz = policy.timezone;
  const wallLocal = wallLocalString(trip.boardTs, tz);
  const rule = findFareRule(policy, trip.routeId, wallLocal);
  const evidence = [];

  if (!rule) {
    return {
      fareCents: 0,
      basis: 'NO_RULE',
      anomaly: { type: 'NO_FARE_RULE', message: `线路 ${trip.routeId} 在 ${wallLocal} 无生效票价规则，按 0 元计并标记异常` },
      evidence,
    };
  }

  // 缺下车记录：待处理不产生费用；约定补扣走线路默认/最高档
  if (trip.status === 'MISSING_ALIGHT') {
    if (policy.missingAlight.mode === 'PENDING') {
      return { fareCents: null, basis: 'PENDING', anomaly: null, evidence: [{
        ruleId: null, ruleType: 'PENDING', action: 'PENDING', amountCents: 0,
        title: '待处理：缺少下车记录', detail: '该行程不参与计费与封顶累计，待补全下车记录后重算',
      }] };
    }
    const assumed = policy.missingAlight.assumedFareYuan === null || policy.missingAlight.assumedFareYuan === ''
      ? routeMaxFareCents(rule)
      : toCents(policy.missingAlight.assumedFareYuan);
    evidence.push({
      ruleId: rule.id, ruleType: 'ASSUMED_FARE', action: 'ASSUMED_FARE', amountCents: assumed,
      title: '约定补扣（缺下车记录）',
      detail: policy.missingAlight.assumedFareYuan === null
        ? `无下车记录，按线路 ${trip.routeId} 最高档票价补扣`
        : `无下车记录，按约定补扣额 ${policy.missingAlight.assumedFareYuan} 元计费`,
    });
    return { fareCents: assumed, basis: 'ASSUMED', anomaly: null, evidence };
  }

  if (rule.type === 'FLAT') {
    evidence.push({
      ruleId: rule.id, ruleType: 'FARE', action: 'BASE_FARE', amountCents: rule.flatFareCents,
      title: '一票制票价', detail: `线路 ${trip.routeId} 上车固定票价`,
    });
    return { fareCents: rule.flatFareCents, basis: 'FLAT', anomaly: null, evidence };
  }

  // DISTANCE：按站序差选档
  const stops = policy.routeStops[rule.routeId] || {};
  const from = Number(stops[trip.boardStopId]);
  const to = Number(stops[trip.alightStopId]);
  if (!from || !to) {
    const fare = routeMaxFareCents(rule);
    evidence.push({
      ruleId: rule.id, ruleType: 'FARE', action: 'BASE_FARE', amountCents: fare,
      title: '里程计价（站点缺失，取最高档）',
      detail: `站点 ${trip.boardStopId}→${trip.alightStopId} 缺少站序，按最高档 ${fare / 100} 元`,
    });
    return { fareCents: fare, basis: 'DISTANCE_FALLBACK', anomaly: { type: 'STOP_ORDER_MISSING', message: '站序数据缺失，已取最高档' }, evidence };
  }
  const traveled = Math.abs(to - from);
  const applicable = rule.tiers.filter(t => traveled <= Number(t.maxStops));
  // 取能覆盖乘车站数的最小 maxStops 档位（即最低适用档，不依赖 tiers 书写顺序）；
  // 无档位覆盖时取最高档兜底
  const tier = applicable.length
    ? applicable.reduce((lo, t) => (Number(t.maxStops) < Number(lo.maxStops) ? t : lo))
    : rule.tiers.reduce((hi, t) => (Number(t.maxStops) > Number(hi.maxStops) ? t : hi), rule.tiers[0]);
  evidence.push({
    ruleId: rule.id, ruleType: 'FARE', action: 'BASE_FARE', amountCents: tier.fareCents,
    title: '里程计价',
    detail: `乘车站数 ${traveled} 站（${trip.boardStopId}→${trip.alightStopId}），适用档位 ≤${tier.maxStops} 站`,
  });
  return { fareCents: tier.fareCents, basis: 'DISTANCE', anomaly: null, evidence };
}

function transferDiscount(rule, trip, prevBilled, baseCents) {
  if (!prevBilled || prevBilled.finalFareCents === null) return null;
  const fromTs = prevBilled.alightTs || prevBilled.boardTs;
  const gap = elapsedMinutes(fromTs, trip.boardTs);
  if (gap > rule.windowMinutes || gap < 0) return null;
  if (rule.sameRouteOnly && prevBilled.routeId !== trip.routeId) return null;

  let amount = rule.discountType === 'PERCENT'
    ? Math.round(baseCents * rule.discountValue / 100)
    : toCents(rule.discountValue);
  if (rule.maxDiscountCents !== null) amount = Math.min(amount, rule.maxDiscountCents);
  amount = clampCents(Math.min(amount, baseCents));
  if (amount <= 0) return null;

  return {
    ruleId: rule.id, ruleType: 'TRANSFER', action: 'DISCOUNT', amountCents: amount,
    title: `换乘优惠：${rule.name}`,
    detail: `距上一车程 ${gap.toFixed(1)} 分钟（窗口 ${rule.windowMinutes} 分钟），` +
      (rule.discountType === 'PERCENT' ? `${rule.discountValue}% 折扣` : `减免 ${rule.discountValue} 元`) +
      `，依据车程 ${prevBilled.tripId}`,
    refs: { prevTripId: prevBilled.tripId, gapMinutes: Number(gap.toFixed(1)), windowMinutes: rule.windowMinutes },
  };
}

function capAdjust(rule, kind, trip, spentCents, currentCents, bucketKey) {
  const remaining = rule.capCents - spentCents;
  if (remaining < 0 || currentCents <= remaining) return null;
  const amount = currentCents - Math.max(0, remaining);
  if (amount <= 0) return null;
  return {
    ruleId: rule.id,
    ruleType: kind,
    action: 'CAP_ADJUST',
    amountCents: amount,
    title: `${kind === 'DAILY_CAP' ? '日' : '周'}封顶：${rule.name}`,
    detail: `本${kind === 'DAILY_CAP' ? '日' : '周'}（${bucketKey}）封顶 ${rule.capCents / 100} 元，` +
      `已累计 ${(spentCents / 100).toFixed(2)} 元，本程应收 ${(currentCents / 100).toFixed(2)} 元，调整 ${(amount / 100).toFixed(2)} 元`,
    refs: { bucket: bucketKey, capCents: rule.capCents, spentBeforeCents: spentCents },
  };
}

/**
 * 对重建后的行程计费。
 * @returns { trips: 计费后行程[], cards: 按卡汇总, totals, policy }
 */
export function billTrips(trips, rawPolicy) {
  const policy = normalizePolicy(rawPolicy);
  const tz = policy.timezone;

  const byCard = new Map();
  for (const t of trips) {
    if (!byCard.has(t.cardId)) byCard.set(t.cardId, []);
    byCard.get(t.cardId).push(t);
  }

  const billedAll = [];
  const cards = [];

  for (const [cardId, cardTrips] of byCard) {
    const sorted = [...cardTrips].sort((a, b) =>
      new Date(a.boardTs) - new Date(b.boardTs) || a.tripId.localeCompare(b.tripId)
    );
    const daySpend = new Map();
    const weekSpend = new Map();
    let prevBilled = null;
    const outTrips = [];

    for (const trip of sorted) {
      const wallLocal = wallLocalString(trip.boardTs, tz);
      const dayKey = businessDate(trip.boardTs, tz);
      const weekKey = weekBucket(dayKey, policy.weekStartsOn);
      const out = {
        ...trip,
        dayKey,
        weekKey,
        policyId: policy.id,
        baseFareCents: null,
        finalFareCents: null,
        discountCents: null,
        billed: false,
        evidence: [...(trip.anomalies || []).map(a => ({
          ruleId: null, ruleType: 'ANOMALY', action: 'INFO', amountCents: 0,
          title: '行程异常', detail: a.message,
        }))],
      };

      const base = baseFare(trip, policy);
      out.evidence.push(...base.evidence);
      if (base.anomaly) out.anomalies = [...(out.anomalies || []), base.anomaly];

      if (base.fareCents === null) {
        // PENDING：不计费、不进封顶累计、不作为换乘依据
        out.basis = base.basis;
        outTrips.push(out);
        billedAll.push(out);
        continue;
      }

      out.billed = true;
      out.basis = base.basis;
      out.baseFareCents = base.fareCents;
      let current = base.fareCents;

      for (const rule of policy.discountRules) {
        if (!isActiveAt(rule, wallLocal)) continue;
        let ev = null;
        if (rule.type === 'TRANSFER') {
          ev = transferDiscount(rule, trip, prevBilled, current);
        } else if (rule.type === 'DAILY_CAP') {
          ev = capAdjust(rule, 'DAILY_CAP', trip, daySpend.get(dayKey) || 0, current, dayKey);
        } else if (rule.type === 'WEEKLY_CAP') {
          ev = capAdjust(rule, 'WEEKLY_CAP', trip, weekSpend.get(weekKey) || 0, current, weekKey);
        }
        if (ev) {
          current = clampCents(current - ev.amountCents);
          out.evidence.push(ev);
        }
      }

      out.finalFareCents = current;
      out.discountCents = out.baseFareCents - out.finalFareCents;
      daySpend.set(dayKey, (daySpend.get(dayKey) || 0) + out.finalFareCents);
      weekSpend.set(weekKey, (weekSpend.get(weekKey) || 0) + out.finalFareCents);
      prevBilled = out;
      outTrips.push(out);
      billedAll.push(out);
    }

    const billed = outTrips.filter(t => t.billed);
    cards.push({
      cardId,
      tripCount: outTrips.length,
      billedCount: billed.length,
      pendingCount: outTrips.length - billed.length,
      baseTotalCents: billed.reduce((s, t) => s + t.baseFareCents, 0),
      finalTotalCents: billed.reduce((s, t) => s + t.finalFareCents, 0),
      discountTotalCents: billed.reduce((s, t) => s + t.discountCents, 0),
      daySpend: [...daySpend.entries()].map(([day, cents]) => ({ day, cents })).sort((a, b) => a.day.localeCompare(b.day)),
      weekSpend: [...weekSpend.entries()].map(([week, cents]) => ({ week, cents })).sort((a, b) => a.week.localeCompare(b.week)),
      trips: outTrips,
    });
  }

  cards.sort((a, b) => a.cardId.localeCompare(b.cardId));
  billedAll.sort((a, b) => new Date(a.boardTs) - new Date(b.boardTs) || a.tripId.localeCompare(b.tripId));

  const totals = {
    tripCount: billedAll.length,
    billedCount: billedAll.filter(t => t.billed).length,
    pendingCount: billedAll.filter(t => !t.billed).length,
    baseTotalCents: cards.reduce((s, c) => s + c.baseTotalCents, 0),
    finalTotalCents: cards.reduce((s, c) => s + c.finalTotalCents, 0),
    discountTotalCents: cards.reduce((s, c) => s + c.discountTotalCents, 0),
  };

  return { policy, trips: billedAll, cards, totals };
}

/** 同一批行程在两套规则下的对比 */
export function comparePolicies(trips, policyA, policyB) {
  const a = billTrips(trips, policyA);
  const b = billTrips(trips, policyB);
  const mapA = new Map(a.trips.map(t => [tripKey(t), t]));
  const mapB = new Map(b.trips.map(t => [tripKey(t), t]));
  const keys = [...new Set([...mapA.keys(), ...mapB.keys()])].sort();

  const rows = keys.map(k => {
    const x = mapA.get(k);
    const y = mapB.get(k);
    const ref = x || y;
    return {
      tripId: ref.tripId,
      cardId: ref.cardId,
      routeId: ref.routeId,
      boardTs: ref.boardTs,
      status: ref.status,
      baseA: x?.baseFareCents ?? null,
      finalA: x?.finalFareCents ?? null,
      baseB: y?.baseFareCents ?? null,
      finalB: y?.finalFareCents ?? null,
      diffCents: (y?.finalFareCents ?? 0) - (x?.finalFareCents ?? 0),
      tripA: x,
      tripB: y,
    };
  });

  return {
    a,
    b,
    rows,
    totals: {
      finalA: a.totals.finalTotalCents,
      finalB: b.totals.finalTotalCents,
      diffCents: b.totals.finalTotalCents - a.totals.finalTotalCents,
    },
  };
}

// 行程稳定键：上车事件唯一标识一个物理行程，补传下车（OPEN→闭合）后身份不变
function tripKey(t) {
  return `${t.cardId}|${t.boardEventId}`;
}
