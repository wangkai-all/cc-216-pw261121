// 导入解析测试：CSV/JSON、中文表头别名、撤销事件、错误行收集
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseEventsText, parsePolicyText } from '../src/web/import.js';
import { parseCsv, toCsv, rowsToObjects } from '../src/core/csv.js';

test('CSV 解析：引号转义、CRLF、中文表头别名', () => {
  const csv = [
    '事件ID,卡号,线路,事件类型,站点,刷卡时间,撤销事件ID',
    'E1,CARD-1,BUS-01,上车,ST-A1,2026-11-09T08:00:00+08:00,',
    'E2,CARD-1,BUS-01,下车,"ST,A2",2026-11-09T08:30:00+08:00,',
    'X1,CARD-1,BUS-01,撤销,,,E1',
  ].join('\r\n');

  const { events, errors } = parseEventsText(csv, 'events.csv');
  assert.equal(errors.length, 0);
  assert.equal(events.length, 3);
  assert.equal(events[0].eventType, 'BOARD');
  assert.equal(events[1].stopId, 'ST,A2'); // 引号内逗号不切分
  assert.equal(events[2].eventType, 'CANCEL');
  assert.equal(events[2].cancelEventId, 'E1');
  // 时间统一为绝对 ISO
  assert.ok(events[0].ts.endsWith('Z'));
  // uploadedTs 缺省回退为 ts
  assert.equal(events[0].uploadedTs, events[0].ts);
});

test('JSON 数组与 {events:[]} 两种结构均可导入', () => {
  const arr = [{ eventId: 'E1', cardId: 'C1', routeId: 'R1', eventType: 'BOARD', ts: '2026-11-09T08:00:00Z' }];
  assert.equal(parseEventsText(JSON.stringify(arr)).events.length, 1);
  assert.equal(parseEventsText(JSON.stringify({ events: arr })).events.length, 1);
});

test('导入错误收集：缺字段、非法类型、坏时间、重复 ID 不中断整体解析', () => {
  const rows = [
    { eventId: 'G1', cardId: 'C1', routeId: 'R1', eventType: 'BOARD', ts: '2026-11-09T08:00:00Z' },
    { eventId: 'G2', cardId: 'C1', routeId: 'R1', eventType: 'TAP', ts: '2026-11-09T09:00:00Z' },
    { eventId: 'G3', cardId: 'C1', routeId: 'R1', eventType: 'BOARD', ts: 'not-a-date' },
    { eventId: 'G1', cardId: 'C2', routeId: 'R1', eventType: 'ALIGHT', ts: '2026-11-09T10:00:00Z' },
    { cardId: 'C3', routeId: 'R1', eventType: 'BOARD', ts: '2026-11-09T11:00:00Z' },
  ];
  const { events, errors } = parseEventsText(JSON.stringify(rows));
  assert.equal(events.length, 1); // 仅 G1 第一次出现有效
  assert.ok(errors.length >= 3);
});

test('规则方案导入：校验类型并归一化生效时间', () => {
  const policy = {
    id: 'p', timezone: 'Asia/Shanghai',
    missingAlight: { mode: 'PENDING' },
    fareRules: [{ id: 'f', routeId: 'R1', type: 'FLAT', flatFareYuan: 2, effectiveFrom: '2026-11-09T16:45:00Z' }],
    discountRules: [{ id: 'd', type: 'DAILY_CAP', priority: 20, capYuan: 15 }],
  };
  const { policy: p, errors } = parsePolicyText(JSON.stringify(policy));
  assert.equal(errors.length, 0);
  // 绝对时间 16:45Z → 上海墙钟次日 00:45
  assert.equal(p.fareRules[0].effectiveFrom, '2026-11-10T00:45');

  const bad = parsePolicyText(JSON.stringify({ discountRules: [{ type: 'MYSTERY' }], fareRules: [] }));
  assert.ok(bad.errors.some(e => e.includes('类型非法')));
});

test('CSV 往返序列化保持字段一致', () => {
  const rows = [['a', 'b,c', 'say "hi"'], ['1', '2', '3']];
  const csv = toCsv(rows);
  const back = parseCsv(csv);
  assert.deepEqual(back, rows);

  const objs = rowsToObjects(parseCsv(toCsv([['event_id', 'card_id'], ['E1', 'C1']])), { event_id: 'eventId', card_id: 'cardId' });
  assert.deepEqual(objs[0], { eventId: 'E1', cardId: 'C1' });
});
