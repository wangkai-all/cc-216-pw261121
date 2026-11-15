// 虚构示例数据：所有卡号、线路、站点均为演示用，与任何真实机构无关。
// 覆盖：完整车程、缺下车（两种策略）、跨午夜换乘、周日深夜跨周界、
// 离线补传（uploadedTs 晚于事件）、撤销刷卡、生效时间切换、里程计价。

export const SAMPLE_EVENTS = [
  // ── CARD-1001：常规通勤 + 跨午夜换乘 + 周界 ──
  { eventId: 'EV-0001', cardId: 'CARD-1001', routeId: 'BUS-01', eventType: 'BOARD', stopId: 'ST-A1', ts: '2026-11-09T07:40:00+08:00', uploadedTs: '2026-11-09T07:40:02+08:00', source: 'ONLINE' },
  { eventId: 'EV-0002', cardId: 'CARD-1001', routeId: 'BUS-01', eventType: 'ALIGHT', stopId: 'ST-A7', ts: '2026-11-09T08:20:00+08:00', uploadedTs: '2026-11-09T08:20:03+08:00', source: 'ONLINE' },
  { eventId: 'EV-0003', cardId: 'CARD-1001', routeId: 'BUS-02', eventType: 'BOARD', stopId: 'ST-B2', ts: '2026-11-09T09:00:00+08:00', uploadedTs: '2026-11-09T09:00:02+08:00', source: 'ONLINE' },
  { eventId: 'EV-0004', cardId: 'CARD-1001', routeId: 'BUS-02', eventType: 'ALIGHT', stopId: 'ST-B9', ts: '2026-11-09T09:35:00+08:00', uploadedTs: '2026-11-09T09:35:02+08:00', source: 'ONLINE' },
  // 跨午夜：23:20 上车，次日 00:10 下车，00:25 换乘（绝对间隔 75 分钟）
  { eventId: 'EV-0005', cardId: 'CARD-1001', routeId: 'BUS-01', eventType: 'BOARD', stopId: 'ST-A7', ts: '2026-11-09T23:20:00+08:00', uploadedTs: '2026-11-09T23:20:02+08:00', source: 'ONLINE' },
  { eventId: 'EV-0006', cardId: 'CARD-1001', routeId: 'BUS-01', eventType: 'ALIGHT', stopId: 'ST-A1', ts: '2026-11-10T00:10:00+08:00', uploadedTs: '2026-11-10T00:10:02+08:00', source: 'ONLINE' },
  { eventId: 'EV-0007', cardId: 'CARD-1001', routeId: 'BUS-02', eventType: 'BOARD', stopId: 'ST-B9', ts: '2026-11-10T00:25:00+08:00', uploadedTs: '2026-11-10T00:25:02+08:00', source: 'ONLINE' },
  { eventId: 'EV-0008', cardId: 'CARD-1001', routeId: 'BUS-02', eventType: 'ALIGHT', stopId: 'ST-B2', ts: '2026-11-10T01:05:00+08:00', uploadedTs: '2026-11-10T01:05:02+08:00', source: 'ONLINE' },
  // 周日深夜（11-08），跨周一凌晨 → 验证周界归桶
  { eventId: 'EV-0009', cardId: 'CARD-1001', routeId: 'BUS-01', eventType: 'BOARD', stopId: 'ST-A1', ts: '2026-11-08T23:40:00+08:00', uploadedTs: '2026-11-08T23:40:02+08:00', source: 'ONLINE' },
  { eventId: 'EV-0010', cardId: 'CARD-1001', routeId: 'BUS-01', eventType: 'ALIGHT', stopId: 'ST-A7', ts: '2026-11-09T00:25:00+08:00', uploadedTs: '2026-11-09T00:25:02+08:00', source: 'ONLINE' },

  // ── CARD-1002：缺下车记录（无配对 ALIGHT）+ 离线补传场景 ──
  { eventId: 'EV-0011', cardId: 'CARD-1002', routeId: 'BUS-02', eventType: 'BOARD', stopId: 'ST-B2', ts: '2026-11-10T08:10:00+08:00', uploadedTs: '2026-11-10T08:10:02+08:00', source: 'ONLINE' },
  // EV-0012 为离线设备补传的下车记录（上传时间晚两天），在“补传演示”中再加入
  // { eventId: 'EV-0012', ... ALIGHT 2026-11-10T08:55, uploadedTs 2026-11-12 ... }
  { eventId: 'EV-0013', cardId: 'CARD-1002', routeId: 'BUS-03', eventType: 'BOARD', stopId: 'ST-C1', ts: '2026-11-11T07:55:00+08:00', uploadedTs: '2026-11-11T07:55:02+08:00', source: 'ONLINE' },
  { eventId: 'EV-0014', cardId: 'CARD-1002', routeId: 'BUS-03', eventType: 'ALIGHT', stopId: 'ST-C9', ts: '2026-11-11T08:40:00+08:00', uploadedTs: '2026-11-11T08:40:02+08:00', source: 'ONLINE' },

  // ── CARD-1003：高频乘车触发日封顶/周封顶 ──
  ...[
    ['2026-11-09T06:30:00+08:00', '2026-11-09T07:10:00+08:00'],
    ['2026-11-09T09:30:00+08:00', '2026-11-09T10:15:00+08:00'],
    ['2026-11-09T13:00:00+08:00', '2026-11-09T13:45:00+08:00'],
    ['2026-11-09T16:20:00+08:00', '2026-11-09T17:05:00+08:00'],
    ['2026-11-09T19:30:00+08:00', '2026-11-09T20:15:00+08:00'],
    ['2026-11-11T08:00:00+08:00', '2026-11-11T08:45:00+08:00'],
    ['2026-11-12T08:00:00+08:00', '2026-11-12T08:45:00+08:00'],
  ].flatMap(([b, a], i) => [
    { eventId: `EV-B${String(i + 1).padStart(2, '0')}`, cardId: 'CARD-1003', routeId: 'BUS-02', eventType: 'BOARD', stopId: 'ST-B2', ts: b, uploadedTs: b, source: 'ONLINE' },
    { eventId: `EV-A${String(i + 1).padStart(2, '0')}`, cardId: 'CARD-1003', routeId: 'BUS-02', eventType: 'ALIGHT', stopId: 'ST-B9', ts: a, uploadedTs: a, source: 'ONLINE' },
  ]),
];

// 离线补传演示用的迟到下车事件
export const BACKFILL_EVENT = {
  eventId: 'EV-0012', cardId: 'CARD-1002', routeId: 'BUS-02', eventType: 'ALIGHT',
  stopId: 'ST-B9', ts: '2026-11-10T08:55:00+08:00',
  uploadedTs: '2026-11-12T21:14:00+08:00', source: 'OFFLINE_BACKFILL',
};

// 撤销演示：撤销 CARD-1003 的第一程（EV-B01/EV-A01），后续换乘优惠应被收回
export const CANCEL_EVENTS = [
  { eventId: 'EV-X01', cardId: 'CARD-1003', routeId: 'BUS-02', eventType: 'CANCEL', cancelEventId: 'EV-B01', ts: '2026-11-13T10:00:00+08:00', uploadedTs: '2026-11-13T10:00:00+08:00', source: 'ADJUSTMENT' },
  { eventId: 'EV-X02', cardId: 'CARD-1003', routeId: 'BUS-02', eventType: 'CANCEL', cancelEventId: 'EV-A01', ts: '2026-11-13T10:00:00+08:00', uploadedTs: '2026-11-13T10:00:00+08:00', source: 'ADJUSTMENT' },
];

export function buildSamplePolicyA() {
  return {
    id: 'policy-a',
    name: '基准方案 A（现行规则）',
    timezone: 'Asia/Shanghai',
    weekStartsOn: 1,
    missingAlight: { mode: 'DEFAULT_FARE', assumedFareYuan: 4 },
    fareRules: [
      { id: 'FR-BUS01', routeId: 'BUS-01', type: 'FLAT', flatFareYuan: 2, effectiveFrom: '', effectiveTo: '' },
      { id: 'FR-BUS02', routeId: 'BUS-02', type: 'FLAT', flatFareYuan: 3, effectiveFrom: '', effectiveTo: '' },
      {
        id: 'FR-BUS03', routeId: 'BUS-03', type: 'DISTANCE',
        tiers: [
          { maxStops: 5, fareYuan: 2 },
          { maxStops: 10, fareYuan: 3 },
          { maxStops: 20, fareYuan: 5 },
        ],
        effectiveFrom: '', effectiveTo: '',
      },
      // 11-12 起 BUS-01 调价到 2.5 元（生效时间演示）
      { id: 'FR-BUS01-V2', routeId: 'BUS-01', type: 'FLAT', flatFareYuan: 2.5, effectiveFrom: '2026-11-12T00:00', effectiveTo: '' },
    ],
    routeStops: {
      'BUS-03': { 'ST-C1': 1, 'ST-C2': 2, 'ST-C3': 3, 'ST-C4': 4, 'ST-C5': 5, 'ST-C9': 9 },
    },
    discountRules: [
      { id: 'DR-TRANSFER', type: 'TRANSFER', name: '90 分钟换乘 5 折', priority: 10, windowMinutes: 90, discountType: 'PERCENT', discountValue: 50, maxDiscountYuan: 2, sameRouteOnly: false, effectiveFrom: '', effectiveTo: '' },
      { id: 'DR-DAILY', type: 'DAILY_CAP', name: '日封顶 15 元', priority: 20, capYuan: 15, effectiveFrom: '', effectiveTo: '' },
      { id: 'DR-WEEKLY', type: 'WEEKLY_CAP', name: '周封顶 60 元', priority: 30, capYuan: 60, effectiveFrom: '', effectiveTo: '' },
    ],
  };
}

export function buildSamplePolicyB() {
  return {
    id: 'policy-b',
    name: '候选方案 B（优惠收紧 + 封顶下调）',
    timezone: 'Asia/Shanghai',
    weekStartsOn: 1,
    missingAlight: { mode: 'PENDING', assumedFareYuan: null },
    fareRules: [
      { id: 'FR-BUS01', routeId: 'BUS-01', type: 'FLAT', flatFareYuan: 2, effectiveFrom: '', effectiveTo: '' },
      { id: 'FR-BUS02', routeId: 'BUS-02', type: 'FLAT', flatFareYuan: 3, effectiveFrom: '', effectiveTo: '' },
      {
        id: 'FR-BUS03', routeId: 'BUS-03', type: 'DISTANCE',
        tiers: [
          { maxStops: 5, fareYuan: 2 },
          { maxStops: 10, fareYuan: 3 },
          { maxStops: 20, fareYuan: 5 },
        ],
        effectiveFrom: '', effectiveTo: '',
      },
      { id: 'FR-BUS01-V2', routeId: 'BUS-01', type: 'FLAT', flatFareYuan: 2.5, effectiveFrom: '2026-11-12T00:00', effectiveTo: '' },
    ],
    routeStops: {
      'BUS-03': { 'ST-C1': 1, 'ST-C2': 2, 'ST-C3': 3, 'ST-C4': 4, 'ST-C5': 5, 'ST-C9': 9 },
    },
    discountRules: [
      // 换乘窗口缩短到 60 分钟、75 折、无封顶折扣上限
      { id: 'DR-TRANSFER-B', type: 'TRANSFER', name: '60 分钟换乘 75 折', priority: 10, windowMinutes: 60, discountType: 'PERCENT', discountValue: 25, maxDiscountYuan: null, sameRouteOnly: false, effectiveFrom: '', effectiveTo: '' },
      { id: 'DR-DAILY-B', type: 'DAILY_CAP', name: '日封顶 12 元', priority: 20, capYuan: 12, effectiveFrom: '', effectiveTo: '' },
      { id: 'DR-WEEKLY-B', type: 'WEEKLY_CAP', name: '周封顶 50 元', priority: 30, capYuan: 50, effectiveFrom: '', effectiveTo: '' },
    ],
  };
}
