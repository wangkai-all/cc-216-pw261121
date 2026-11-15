// 端到端冒烟：示例数据 → 首次计费 → 离线补传 → 撤销 → 双方案对比
// 不依赖 DOM，直接驱动核心层。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runBilling } from '../src/core/recompute.js';
import { reconstructTrips } from '../src/core/trips.js';
import { comparePolicies } from '../src/core/engine.js';
import {
  SAMPLE_EVENTS, BACKFILL_EVENT, CANCEL_EVENTS,
  buildSamplePolicyA, buildSamplePolicyB,
} from '../src/web/sample-data.js';

test('E2E：示例数据完整回放 + 补传差额 + 撤销重算 + 方案对比', () => {
  const state = {
    events: JSON.parse(JSON.stringify(SAMPLE_EVENTS)),
    policy: buildSamplePolicyA(),
    history: [],
    runSeq: 0,
  };

  // 1. 首次计费
  const run1 = runBilling(state, { kind: 'IMPORT', note: '示例首次导入' });
  assert.ok(run1.totals.tripCount >= 10);
  assert.equal(run1.totals.pendingCount, 0); // A 方案为约定补扣，无 PENDING
  const card1002Before = run1.result.cards.find(c => c.cardId === 'CARD-1002');
  const missingTrip = run1.result.trips.find(t => t.cardId === 'CARD-1002' && t.status === 'MISSING_ALIGHT');
  assert.ok(missingTrip, 'CARD-1002 应有缺下车行程');
  assert.equal(missingTrip.basis, 'ASSUMED');
  assert.equal(missingTrip.finalFareCents, 400); // 约定补扣 4 元

  // 跨午夜换乘仍拿到优惠（EV-0007）
  const crossMidnight = run1.result.trips.find(t => t.boardEventId === 'EV-0007');
  assert.ok(crossMidnight.evidence.some(e => e.ruleType === 'TRANSFER'), '跨午夜换乘应有优惠');

  // 2. 离线补传
  state.events.push(JSON.parse(JSON.stringify(BACKFILL_EVENT)));
  const run2 = runBilling(state, { kind: 'BACKFILL', note: '补传下车' });
  const closed = run2.result.trips.find(t => t.boardEventId === 'EV-0011');
  assert.equal(closed.status, 'COMPLETE');
  assert.equal(closed.finalFareCents, 300); // BUS-02 一票制 3 元
  const changed = run2.diffs.changedTrips.find(t => t.tripId === missingTrip.tripId);
  assert.equal(changed.deltaCents, -100); // 4.00 → 3.00，退回 1 元
  assert.equal(state.history.length, 2); // 快照保留

  // 3. 撤销
  state.events.push(...JSON.parse(JSON.stringify(CANCEL_EVENTS)));
  const run3 = runBilling(state, { kind: 'CANCEL', note: '撤销首程' });
  assert.ok(run3.diffs.removedTrips.some(t => t.cardId === 'CARD-1003'));
  assert.equal(state.history.length, 3);
  // 历史快照不被覆盖
  assert.notEqual(state.history[2].totals.finalTotalCents, state.history[0].totals.finalTotalCents);

  // 4. 双方案对比（同一批事件）
  const { trips } = reconstructTrips(state.events);
  const cmp = comparePolicies(trips, buildSamplePolicyA(), buildSamplePolicyB());
  assert.equal(cmp.rows.length, cmp.a.trips.length);
  assert.equal(cmp.totals.diffCents, cmp.totals.finalB - cmp.totals.finalA);

  // 补传前的事件集上，B 方案（PENDING）应有待处理行程而 A 方案（约定补扣）没有
  const beforeTrips = reconstructTrips(JSON.parse(JSON.stringify(SAMPLE_EVENTS))).trips;
  const cmpBefore = comparePolicies(beforeTrips, buildSamplePolicyA(), buildSamplePolicyB());
  assert.ok(cmpBefore.b.totals.pendingCount >= 1);
  assert.equal(cmpBefore.a.totals.pendingCount, 0);

  // 每行都能展开两套 evidence
  for (const row of cmp.rows) {
    assert.ok(row.tripA && row.tripB);
    assert.ok(Array.isArray(row.tripA.evidence) && Array.isArray(row.tripB.evidence));
  }

  // 5. 受影响周期重算：差额里包含日/周累计
  assert.ok(Array.isArray(run3.diffs.periodTotals.days));
  assert.ok(Array.isArray(run3.diffs.periodTotals.weeks));
});
