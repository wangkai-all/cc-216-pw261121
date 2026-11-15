import { test } from 'node:test';
import assert from 'node:assert/strict';

import { reconstructTrips, affectedCardIds } from '../src/core/trips.js';
import { billTrips, comparePolicies, normalizePolicy, baseFare } from '../src/core/engine.js';
import { runBilling } from '../src/core/recompute.js';
import { businessDate, weekBucket, wallLocalString } from '../src/core/time.js';

const TZ = 'Asia/Shanghai';

function ev(eventId, cardId, routeId, eventType, ts, extra = {}) {
  return { eventId, cardId, routeId, eventType, ts, stopId: extra.stopId ?? null, uploadedTs: extra.uploadedTs ?? ts, ...extra };
}

function policy(overrides = {}) {
  const base = {
    id: 'P',
    name: '测试方案',
    timezone: TZ,
    weekStartsOn: 1,
    missingAlight: { mode: 'DEFAULT_FARE', assumedFareYuan: null },
    fareRules: [
      { id: 'F1', routeId: 'BUS-01', type: 'FLAT', flatFareYuan: 2, effectiveFrom: '', effectiveTo: '' },
      { id: 'F2', routeId: 'BUS-02', type: 'FLAT', flatFareYuan: 3, effectiveFrom: '', effectiveTo: '' },
      {
        id: 'F3', routeId: 'BUS-03', type: 'DISTANCE',
        tiers: [{ maxStops: 5, fareYuan: 2 }, { maxStops: 20, fareYuan: 4 }],
        effectiveFrom: '', effectiveTo: '',
      },
    ],
    routeStops: {
      'BUS-03': { S1: 1, S2: 2, S3: 3, S8: 8, S9: 9 },
    },
    discountRules: [
      { id: 'D1', type: 'TRANSFER', name: '换乘', priority: 10, windowMinutes: 90, discountType: 'PERCENT', discountValue: 50, maxDiscountYuan: null, sameRouteOnly: false, effectiveFrom: '', effectiveTo: '' },
      { id: 'D2', type: 'DAILY_CAP', name: '日封顶', priority: 20, capYuan: 15, effectiveFrom: '', effectiveTo: '' },
      { id: 'D3', type: 'WEEKLY_CAP', name: '周封顶', priority: 30, capYuan: 60, effectiveFrom: '', effectiveTo: '' },
    ],
  };
  // 返回未归一化原始方案的独立副本；需要已归一化方案时显式调 normalizePolicy()
  return JSON.parse(JSON.stringify({ ...base, ...overrides }));
}

test('行程重建：完整行程、缺下车、孤儿下车、撤销', () => {
  const raw = [
    ev('E1', 'C1', 'BUS-01', 'BOARD', '2026-11-09T08:00:00+08:00', { stopId: 'S1' }),
    ev('E2', 'C1', 'BUS-01', 'ALIGHT', '2026-11-09T08:30:00+08:00', { stopId: 'S2' }),
    ev('E3', 'C1', 'BUS-02', 'BOARD', '2026-11-09T10:00:00+08:00'), // 缺下车
    ev('E4', 'C2', 'BUS-01', 'ALIGHT', '2026-11-09T11:00:00+08:00'), // 孤儿下车
  ];
  const { trips, anomalies } = reconstructTrips(raw);
  assert.equal(trips.length, 2);
  assert.equal(trips[0].status, 'COMPLETE');
  assert.equal(trips[1].status, 'MISSING_ALIGHT');
  assert.ok(anomalies.some(a => a.type === 'ORPHAN_ALIGHT'));
  assert.ok(anomalies.some(a => a.type === 'MISSING_ALIGHT'));

  // 撤销 E3 后只剩完整行程
  const cancelled = [...raw, { eventId: 'X1', cardId: 'C1', routeId: 'BUS-02', eventType: 'CANCEL', ts: '2026-11-09T12:00:00+08:00', cancelEventId: 'E3' }];
  const r2 = reconstructTrips(cancelled);
  assert.equal(r2.trips.length, 1);
  assert.equal(r2.trips[0].status, 'COMPLETE');
});

test('缺下车策略：PENDING 不计费且不做换乘依据；DEFAULT_FARE 按约定补扣', () => {
  const tripsPending = reconstructTrips([
    ev('E1', 'C1', 'BUS-01', 'BOARD', '2026-11-09T08:00:00+08:00'),
    ev('E2', 'C1', 'BUS-02', 'BOARD', '2026-11-09T09:00:00+08:00'),
    ev('E3', 'C1', 'BUS-02', 'ALIGHT', '2026-11-09T09:30:00+08:00'),
  ]).trips;

  const pPending = policy({ missingAlight: { mode: 'PENDING', assumedFareYuan: null } });
  const r1 = billTrips(tripsPending, pPending);
  const [t1, t2] = r1.trips;
  assert.equal(t1.billed, false);
  assert.equal(t1.finalFareCents, null);
  assert.equal(r1.totals.pendingCount, 1);
  // 待处理行程之后的完整行程不能拿到换乘优惠（无有效上一车程）
  assert.equal(t2.finalFareCents, 300);

  const pDefault = policy({ missingAlight: { mode: 'DEFAULT_FARE', assumedFareYuan: 4 } });
  const r2 = billTrips(tripsPending, pDefault);
  assert.equal(r2.trips[0].finalFareCents, 400);
  assert.equal(r2.trips[0].basis, 'ASSUMED');
  // 约定补扣车程可作为换乘依据：下一程 90 分钟内享 5 折
  assert.equal(r2.trips[1].finalFareCents, 150);

  // 未配置约定额时取线路最高档
  const pMax = policy({ missingAlight: { mode: 'DEFAULT_FARE', assumedFareYuan: null } });
  const r3 = billTrips(tripsPending, pMax);
  assert.equal(r3.trips[0].finalFareCents, 200); // BUS-01 一票制 2 元
});

test('换乘优惠：90 分钟窗口基于绝对时刻，跨午夜仍有效', () => {
  const trips = reconstructTrips([
    ev('E1', 'C1', 'BUS-01', 'BOARD', '2026-11-09T23:20:00+08:00'),
    ev('E2', 'C1', 'BUS-01', 'ALIGHT', '2026-11-09T23:50:00+08:00'),
    ev('E3', 'C1', 'BUS-02', 'BOARD', '2026-11-10T00:10:00+08:00'), // 间隔 20 分钟，跨午夜
    ev('E4', 'C1', 'BUS-02', 'ALIGHT', '2026-11-10T00:40:00+08:00'),
    ev('E5', 'C1', 'BUS-01', 'BOARD', '2026-11-10T02:00:00+08:00'), // 距上一程 80 分钟，仍在窗口
    ev('E6', 'C1', 'BUS-01', 'ALIGHT', '2026-11-10T02:30:00+08:00'),
  ]).trips;

  const r = billTrips(trips, policy());
  assert.equal(r.trips[0].finalFareCents, 200);
  assert.equal(r.trips[1].finalFareCents, 150); // 300 五折
  assert.equal(r.trips[2].finalFareCents, 100); // 200 五折
  assert.ok(r.trips[1].evidence.some(e => e.ruleType === 'TRANSFER'));

  // 窗口缩小到 60 分钟：第三程（80 分钟）无优惠
  const p60 = policy();
  p60.discountRules[0].windowMinutes = 60;
  const r2 = billTrips(trips, p60);
  assert.equal(r2.trips[1].finalFareCents, 150);
  assert.equal(r2.trips[2].finalFareCents, 200);
});

test('日封顶按业务时区、以上车时刻归桶；跨午夜行程归入上车日', () => {
  // 23:55 上车、次日 00:30 下车 → dayKey 必须是上车日
  assert.equal(businessDate('2026-11-09T23:55:00+08:00', TZ), '2026-11-09');
  const trips = reconstructTrips([
    ev('E1', 'C1', 'BUS-02', 'BOARD', '2026-11-09T08:00:00+08:00'),
    ev('E2', 'C1', 'BUS-02', 'ALIGHT', '2026-11-09T08:40:00+08:00'),
    ev('E3', 'C1', 'BUS-02', 'BOARD', '2026-11-09T23:55:00+08:00'),
    ev('E4', 'C1', 'BUS-02', 'ALIGHT', '2026-11-10T00:30:00+08:00'),
  ]).trips;

  const p = policy();
  p.discountRules.find(d => d.type === 'DAILY_CAP').capYuan = 5; // 日封顶 5 元
  const r = billTrips(trips, p);
  assert.equal(r.trips[1].dayKey, '2026-11-09'); // 以上车时刻归桶
  // 两程各 3 元 = 600，第二程被调整 100
  assert.equal(r.totals.finalTotalCents, 500);
  const cap = r.trips[1].evidence.find(e => e.ruleType === 'DAILY_CAP');
  assert.ok(cap);
  assert.equal(cap.amountCents, 100);
});

test('周封顶按周一桶，周日深夜跨周界行程归入原周', () => {
  // 2026-11-08 是周日；23:50 上车 → 周桶 2026-11-02（周一）
  assert.equal(weekBucket('2026-11-08', 1), '2026-11-02');
  const trips = reconstructTrips([
    ev('E1', 'C1', 'BUS-02', 'BOARD', '2026-11-08T23:50:00+08:00'),
    ev('E2', 'C1', 'BUS-02', 'ALIGHT', '2026-11-09T00:20:00+08:00'), // 周一凌晨
  ]).trips;

  const p = policy();
  p.discountRules.find(d => d.type === 'WEEKLY_CAP').capYuan = 2; // 周封顶 2 元
  const r = billTrips(trips, p);
  assert.equal(r.trips[0].weekKey, '2026-11-02');
  assert.equal(r.trips[0].finalFareCents, 200); // 300 被调整到 200
  assert.ok(r.trips[0].evidence.some(e => e.ruleType === 'WEEKLY_CAP'));

  // 周起始改周日：该行程归入 2026-11-08 周
  const pSun = policy();
  pSun.weekStartsOn = 0;
  const r2 = billTrips(trips, pSun);
  assert.equal(r2.trips[0].weekKey, '2026-11-08');
});

test('规则按 priority 顺序执行：换乘先于封顶', () => {
  const trips = reconstructTrips([
    ev('E1', 'C1', 'BUS-02', 'BOARD', '2026-11-09T08:00:00+08:00'),
    ev('E2', 'C1', 'BUS-02', 'ALIGHT', '2026-11-09T08:40:00+08:00'),
    ev('E3', 'C1', 'BUS-02', 'BOARD', '2026-11-09T09:00:00+08:00'),
    ev('E4', 'C1', 'BUS-02', 'ALIGHT', '2026-11-09T09:40:00+08:00'),
  ]).trips;
  const p = policy();
  p.discountRules.find(d => d.type === 'DAILY_CAP').capYuan = 4;
  const r = billTrips(trips, p);
  // 300 + (300 五折=150) = 450，超 400 封顶，第二程再减 50 → 100
  assert.equal(r.trips[0].finalFareCents, 300);
  assert.equal(r.trips[1].finalFareCents, 100);
  const types = r.trips[1].evidence.map(e => e.ruleType);
  assert.ok(types.indexOf('TRANSFER') < types.indexOf('DAILY_CAP'));
});

test('生效时间：未生效票价规则走异常，带生效时间的换乘规则按时切换', () => {
  const futureFare = policy();
  futureFare.fareRules = futureFare.fareRules.map(r =>
    r.routeId === 'BUS-01' ? { ...r, effectiveFrom: '2027-01-01T00:00' } : r
  );
  const trips = reconstructTrips([
    ev('E1', 'C1', 'BUS-01', 'BOARD', '2026-11-09T08:00:00+08:00'),
    ev('E2', 'C1', 'BUS-01', 'ALIGHT', '2026-11-09T08:30:00+08:00'),
  ]).trips;
  const r = billTrips(trips, futureFare);
  assert.equal(r.trips[0].baseFareCents, 0);
  assert.ok(r.trips[0].anomalies.some(a => a.type === 'NO_FARE_RULE'));

  // 换乘规则 11-10 才生效：9 号的换乘不优惠，10 号的换乘优惠
  const p = policy();
  p.discountRules.find(d => d.type === 'TRANSFER').effectiveFrom = '2026-11-10T00:00';
  const t2 = reconstructTrips([
    ev('A1', 'C1', 'BUS-01', 'BOARD', '2026-11-09T08:00:00+08:00'),
    ev('A2', 'C1', 'BUS-01', 'ALIGHT', '2026-11-09T08:30:00+08:00'),
    ev('A3', 'C1', 'BUS-02', 'BOARD', '2026-11-09T09:00:00+08:00'),
    ev('A4', 'C1', 'BUS-02', 'ALIGHT', '2026-11-09T09:30:00+08:00'),
    ev('B1', 'C1', 'BUS-01', 'BOARD', '2026-11-10T08:00:00+08:00'),
    ev('B2', 'C1', 'BUS-01', 'ALIGHT', '2026-11-10T08:30:00+08:00'),
    ev('B3', 'C1', 'BUS-02', 'BOARD', '2026-11-10T09:00:00+08:00'),
    ev('B4', 'C1', 'BUS-02', 'ALIGHT', '2026-11-10T09:30:00+08:00'),
  ]).trips;
  const r2 = billTrips(t2, p);
  assert.equal(r2.trips[1].finalFareCents, 300); // 9 号无换乘优惠
  assert.equal(r2.trips[3].finalFareCents, 150); // 10 号有
});

test('里程计价按站序差选档', () => {
  const trips = reconstructTrips([
    ev('E1', 'C1', 'BUS-03', 'BOARD', '2026-11-09T08:00:00+08:00', { stopId: 'S1' }),
    ev('E2', 'C1', 'BUS-03', 'ALIGHT', '2026-11-09T08:30:00+08:00', { stopId: 'S3' }), // 2 站 → 2 元
    ev('E3', 'C1', 'BUS-03', 'BOARD', '2026-11-09T11:00:00+08:00', { stopId: 'S3' }),
    ev('E4', 'C1', 'BUS-03', 'ALIGHT', '2026-11-09T11:30:00+08:00', { stopId: 'S9' }), // 6 站 → 4 元档（与上一程间隔 150 分钟，无换乘）
  ]).trips;
  const pol = policy();
  const r = billTrips(trips, pol);
  assert.equal(r.trips[0].finalFareCents, 200); // S1→S3，2 站，≤5 档
  assert.equal(r.trips[1].finalFareCents, 400); // S3→S9，6 站，≤20 档
});

test('补传后重算：保留快照并输出与原扣费差额', () => {
  const state = {
    events: [ev('E1', 'C1', 'BUS-01', 'BOARD', '2026-11-09T08:00:00+08:00')],
    policy: policy({ missingAlight: { mode: 'DEFAULT_FARE', assumedFareYuan: 4 } }),
    history: [],
    runSeq: 0,
  };
  const run1 = runBilling(state, { kind: 'IMPORT', note: '首次导入' });
  assert.equal(run1.totals.finalTotalCents, 400); // 缺下车按 4 元补扣

  // 离线补传下车记录：同一行程变为一票制 2 元
  state.events.push(ev('E2', 'C1', 'BUS-01', 'ALIGHT', '2026-11-09T08:30:00+08:00', { uploadedTs: '2026-11-12T10:00:00+08:00' }));
  const run2 = runBilling(state, { kind: 'BACKFILL', note: '离线补传下车 E2' });

  assert.equal(state.history.length, 2);
  assert.equal(run2.diffs.baselineRunId, run1.runId);
  assert.deepEqual(run2.diffs.affectedCards || run2.affectedCards, ['C1']);
  assert.equal(run2.diffs.changedTrips.length, 1);
  assert.equal(run2.diffs.changedTrips[0].oldFinalCents, 400);
  assert.equal(run2.diffs.changedTrips[0].newFinalCents, 200);
  assert.equal(run2.diffs.changedTrips[0].deltaCents, -200);
  // 原快照未被覆盖
  assert.equal(state.history[1].totals.finalTotalCents, 400);
  assert.equal(state.history[0].totals.finalTotalCents, 200);
});

test('撤销刷卡后重算：受影响周期内后续行程的换乘优惠被收回', () => {
  const state = {
    events: [
      ev('E1', 'C1', 'BUS-01', 'BOARD', '2026-11-09T08:00:00+08:00'),
      ev('E2', 'C1', 'BUS-01', 'ALIGHT', '2026-11-09T08:30:00+08:00'),
      ev('E3', 'C1', 'BUS-02', 'BOARD', '2026-11-09T09:00:00+08:00'),
      ev('E4', 'C1', 'BUS-02', 'ALIGHT', '2026-11-09T09:30:00+08:00'),
    ],
    policy: policy(),
    history: [],
    runSeq: 0,
  };
  const run1 = runBilling(state, { kind: 'IMPORT', note: '导入' });
  assert.equal(run1.totals.finalTotalCents, 350); // 200 + 150

  // 撤销第一程：第二程失去换乘依据，恢复 300
  state.events.push({ eventId: 'X1', cardId: 'C1', routeId: 'BUS-01', eventType: 'CANCEL', ts: '2026-11-10T12:00:00+08:00', cancelEventId: 'E1' });
  state.events.push({ eventId: 'X2', cardId: 'C1', routeId: 'BUS-01', eventType: 'CANCEL', ts: '2026-11-10T12:00:00+08:00', cancelEventId: 'E2' });
  const run2 = runBilling(state, { kind: 'CANCEL', note: '撤销首程刷卡' });

  assert.equal(run2.diffs.removedTrips.length, 1);
  assert.equal(run2.diffs.changedTrips[0].deltaCents, 150);
  assert.equal(run2.totals.finalTotalCents, 300);
});

test('两方案对比：同一批行程输出逐程差额与总额差', () => {
  const trips = reconstructTrips([
    ev('E1', 'C1', 'BUS-01', 'BOARD', '2026-11-09T08:00:00+08:00'),
    ev('E2', 'C1', 'BUS-01', 'ALIGHT', '2026-11-09T08:30:00+08:00'),
    ev('E3', 'C1', 'BUS-02', 'BOARD', '2026-11-09T09:00:00+08:00'),
    ev('E4', 'C1', 'BUS-02', 'ALIGHT', '2026-11-09T09:30:00+08:00'),
  ]).trips;

  const a = policy({ id: 'A' }); // 换乘 5 折
  const b = policy({ id: 'B' });
  b.discountRules.find(d => d.type === 'TRANSFER').discountValue = 25; // 换乘 75 折
  b.discountRules.find(d => d.type === 'DAILY_CAP').capYuan = 4;

  const cmp = comparePolicies(trips, a, b);
  assert.equal(cmp.rows.length, 2);
  assert.equal(cmp.totals.finalA, 350);
  assert.equal(cmp.totals.finalB, 400); // 200 + 225 = 425 → 日封顶 400
  assert.equal(cmp.totals.diffCents, 50);
  const second = cmp.rows.find(r => r.tripId === trips[1].tripId);
  assert.equal(second.finalA, 150);
  assert.equal(second.finalB, 200);
});

test('UTC 时间按业务时区归桶：16:45Z 是上海次日 00:45', () => {
  assert.equal(businessDate('2026-11-09T15:30:00Z', TZ), '2026-11-09');
  assert.equal(businessDate('2026-11-09T16:45:00Z', TZ), '2026-11-10');
  assert.equal(wallLocalString('2026-11-09T16:45:00Z', TZ), '2026-11-10T00:45');
});

test('封顶累计依据可展开：每程 evidence 完整记录规则与累计值', () => {
  const trips = reconstructTrips([
    ev('E1', 'C1', 'BUS-02', 'BOARD', '2026-11-09T08:00:00+08:00'),
    ev('E2', 'C1', 'BUS-02', 'ALIGHT', '2026-11-09T08:40:00+08:00'),
    ev('E3', 'C1', 'BUS-02', 'BOARD', '2026-11-09T10:00:00+08:00'),
    ev('E4', 'C1', 'BUS-02', 'ALIGHT', '2026-11-09T10:40:00+08:00'),
    ev('E5', 'C1', 'BUS-02', 'BOARD', '2026-11-09T12:00:00+08:00'),
    ev('E6', 'C1', 'BUS-02', 'ALIGHT', '2026-11-09T12:40:00+08:00'),
  ]).trips;
  const p = policy();
  p.discountRules = p.discountRules.filter(d => d.type !== 'TRANSFER'); // 专注封顶，排除换乘干扰
  p.discountRules.find(d => d.type === 'DAILY_CAP').capYuan = 7;
  const r = billTrips(trips, p);
  // 300+300+300=900 → 日封顶 700，第三程调整 200（前两程累计 600）
  const last = r.trips[2];
  const capEv = last.evidence.find(e => e.ruleType === 'DAILY_CAP');
  assert.equal(capEv.refs.spentBeforeCents, 600);
  assert.equal(capEv.refs.capCents, 700);
  assert.equal(last.finalFareCents, 100);
});
