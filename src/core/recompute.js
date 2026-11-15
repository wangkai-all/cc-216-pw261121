// 重算账本：保留每次计算快照，补传/撤销触发受影响周期重算并输出与原扣费的差额。
// 历史快照永不覆盖；差额仅为分析结果，不产生真实扣款。

import { reconstructTrips, affectedCardIds } from './trips.js';
import { billTrips } from './engine.js';

const HISTORY_LIMIT = 30;

/**
 * 基于当前事件全集执行一次计算并记账。
 * @param state { events, policy, history, runSeq }
 * @param reason { kind: 'IMPORT'|'BACKFILL'|'CANCEL'|'RECOMPUTE'|'RULE_EDIT', note, affectedCards? }
 */
export function runBilling(state, reason) {
  const { trips, anomalies } = reconstructTrips(state.events);
  const result = billTrips(trips, state.policy);

  const prevRun = state.history[0] || null;
  const affected = reason.affectedCards
    || (prevRun ? affectedCardIds(prevRun.eventsSnapshot, state.events) : [...new Set(state.events.map(e => e.cardId))]);

  const diffs = diffAgainst(prevRun, result, affected);
  const run = {
    runId: `R${String(state.runSeq + 1).padStart(4, '0')}`,
    ts: new Date().toISOString(),
    reason,
    affectedCards: affected,
    anomalies,
    totals: result.totals,
    eventsSnapshot: JSON.parse(JSON.stringify(state.events)),
    result,
    diffs,
  };

  state.runSeq += 1;
  state.history.unshift(run);
  if (state.history.length > HISTORY_LIMIT) state.history.length = HISTORY_LIMIT;
  state.lastResult = result;
  state.lastAnomalies = anomalies;
  return run;
}

/**
 * 对比新旧结果，仅输出受影响卡号、且行程键匹配的扣费差额。
 * 新出现/消失的行程单独列出，不伪造差额。
 */
function diffAgainst(prevRun, nextResult, affectedCards) {
  if (!prevRun) {
    return {
      baselineRunId: null,
      changedTrips: [],
      newTrips: nextResult.trips.map(t => tripRef(t)),
      removedTrips: [],
      periodTotals: aggregatePeriods(nextResult, affectedCards),
    };
  }
  const prev = new Map(prevRun.result.trips.map(t => [keyOf(t), t]));
  const next = new Map(nextResult.trips.map(t => [keyOf(t), t]));

  const changedTrips = [];
  const newTrips = [];
  for (const [k, t] of next) {
    if (!affectedCards.includes(t.cardId)) continue;
    const old = prev.get(k);
    if (!old) { newTrips.push(tripRef(t)); continue; }
    const oldFinal = old.finalFareCents ?? 0;
    const newFinal = t.finalFareCents ?? 0;
    if (oldFinal !== newFinal || old.billed !== t.billed) {
      changedTrips.push({
        tripId: t.tripId,
        cardId: t.cardId,
        routeId: t.routeId,
        boardTs: t.boardTs,
        dayKey: t.dayKey,
        weekKey: t.weekKey,
        oldFinalCents: old.finalFareCents,
        newFinalCents: t.finalFareCents,
        deltaCents: newFinal - oldFinal,
        oldBilled: old.billed,
        newBilled: t.billed,
        reason: t.billed !== old.billed
          ? (t.billed ? '待处理行程已转为计费' : '计费行程已转为待处理')
          : '受优惠/封顶/票价规则变化影响',
      });
    }
  }
  const removedTrips = [];
  for (const [k, t] of prev) {
    if (!affectedCards.includes(t.cardId)) continue;
    if (!next.has(k)) removedTrips.push(tripRef(t));
  }

  return {
    baselineRunId: prevRun.runId,
    changedTrips: changedTrips.sort((a, b) => a.boardTs.localeCompare(b.boardTs)),
    newTrips,
    removedTrips,
    periodTotals: aggregatePeriods(nextResult, affectedCards),
  };
}

/** 受影响卡号在每个业务日/周的最新累计（用于说明波及的封顶周期） */
function aggregatePeriods(result, affectedCards) {
  const days = new Map();
  const weeks = new Map();
  for (const c of result.cards) {
    if (!affectedCards.includes(c.cardId)) continue;
    for (const d of c.daySpend) days.set(`${c.cardId}|${d.day}`, { cardId: c.cardId, period: d.day, cents: d.cents });
    for (const w of c.weekSpend) weeks.set(`${c.cardId}|${w.week}`, { cardId: c.cardId, period: w.week, cents: w.cents });
  }
  return {
    days: [...days.values()].sort((a, b) => a.period.localeCompare(b.period)),
    weeks: [...weeks.values()].sort((a, b) => a.period.localeCompare(b.period)),
  };
}

function tripRef(t) {
  return {
    tripId: t.tripId, cardId: t.cardId, routeId: t.routeId,
    boardTs: t.boardTs, alightTs: t.alightTs, status: t.status,
    finalFareCents: t.finalFareCents, dayKey: t.dayKey, weekKey: t.weekKey,
  };
}

function keyOf(t) {
  // 上车事件唯一标识一个物理行程，补传下车后身份不变
  return `${t.cardId}|${t.boardEventId}`;
}
