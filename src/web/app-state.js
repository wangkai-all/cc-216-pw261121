// 应用主状态机：事件全集、两套候选方案、计算历史与视图路由。
import { loadState, saveState, clearState } from './storage.js';
import { runBilling } from '../core/recompute.js';
import { reconstructTrips } from '../core/trips.js';
import { comparePolicies } from '../core/engine.js';
import {
  SAMPLE_EVENTS, BACKFILL_EVENT, CANCEL_EVENTS,
  buildSamplePolicyA, buildSamplePolicyB,
} from './sample-data.js';

export function createInitialState() {
  return {
    events: [],
    policyA: buildSamplePolicyA(),
    policyB: buildSamplePolicyB(),
    activePolicy: 'A', // 回放/重算页使用的方案
    policy: null, // 同步自当前激活方案，供核心层 runBilling 使用
    history: [],
    runSeq: 0,
    lastResult: null,
    lastAnomalies: [],
    comparison: null,
  };
}

/** 核心层从 state.policy 取方案；每次计费前把当前激活方案同步过去 */
function syncPolicy(state) {
  state.policy = activePolicy(state);
}

export function bootstrap() {
  const saved = loadState();
  if (saved && Array.isArray(saved.events)) return saved;
  return createInitialState();
}

export function persist(state) {
  // 历史里的完整结果体积大，持久化时保留但限制快照大小已由 recompute 控制
  saveState(state);
}

export function hardReset() {
  clearState();
  return createInitialState();
}

export function loadSampleData(state) {
  state.events = JSON.parse(JSON.stringify(SAMPLE_EVENTS));
  state.policyA = buildSamplePolicyA();
  state.policyB = buildSamplePolicyB();
  state.history = [];
  state.runSeq = 0;
  state.lastResult = null;
  state.lastAnomalies = [];
  state.comparison = null;
  syncPolicy(state);
  runBilling(state, { kind: 'IMPORT', note: '载入虚构示例数据' });
  persist(state);
}

export function activePolicy(state) {
  return state.activePolicy === 'B' ? state.policyB : state.policyA;
}

/** 导入/追加事件后重算 */
export function importEvents(state, incoming, reason) {
  const existing = new Set(state.events.map(e => e.eventId));
  const fresh = incoming.filter(e => !existing.has(e.eventId));
  state.events.push(...fresh);
  syncPolicy(state);
  const run = runBilling(state, reason);
  persist(state);
  return { run, added: fresh.length, duplicated: incoming.length - fresh.length };
}

export function applyBackfill(state) {
  const res = importEvents(state, [BACKFILL_EVENT], {
    kind: 'BACKFILL',
    note: `离线补传下车事件 ${BACKFILL_EVENT.eventId}（上传时间晚于发生时间）`,
  });
  persist(state);
  return res;
}

export function applyCancel(state) {
  const res = importEvents(state, CANCEL_EVENTS, {
    kind: 'CANCEL',
    note: '撤销 CARD-1003 首程上下车刷卡，重算受影响日/周',
  });
  persist(state);
  return res;
}

/** 规则编辑后用新方案重算 */
export function recomputeWithActivePolicy(state, note = '规则编辑后重算') {
  syncPolicy(state);
  const run = runBilling(state, { kind: 'RULE_EDIT', note });
  state.comparison = null;
  persist(state);
  return run;
}

export function runComparison(state) {
  const { trips } = reconstructTrips(state.events);
  state.comparison = comparePolicies(trips, state.policyA, state.policyB);
  persist(state);
  return state.comparison;
}

export function currentReconstruction(state) {
  return reconstructTrips(state.events);
}
