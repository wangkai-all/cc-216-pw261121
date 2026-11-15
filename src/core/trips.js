// 行程重建：把刷卡事件按卡号还原为可计费行程。
// 状态机：BOARD -> ALIGHT 闭合；缺下车记录不假设完整，按策略进入待处理或约定补扣。
// 撤销事件（eventType=CANCEL，引用原 eventId）使原事件失效后整体重配。

export const EVENT_ALIASES = {
  event_id: 'eventId', 事件ID: 'eventId',
  card_id: 'cardId', 卡号: 'cardId',
  route_id: 'routeId', 线路: 'routeId', 线路ID: 'routeId',
  event_type: 'eventType', 事件类型: 'eventType',
  stop_id: 'stopId', 站点: 'stopId', 站点ID: 'stopId',
  ts: 'ts', 时间: 'ts', 刷卡时间: 'ts',
  uploaded_ts: 'uploadedTs', 上传时间: 'uploadedTs',
  cancel_event_id: 'cancelEventId', 撤销事件ID: 'cancelEventId',
  source: 'source', 来源: 'source',
};

/** 规范化导入事件；返回带 status 的事件数组，撤销事件本身不参与配对 */
export function normalizeEvents(rawEvents) {
  const byId = new Map();
  rawEvents.forEach(e => byId.set(e.eventId, { ...e }));

  // 处理撤销：CANCEL 事件把被引用事件标记 CANCELLED
  const cancels = [];
  for (const e of byId.values()) {
    if (String(e.eventType).toUpperCase() === 'CANCEL') cancels.push(e);
  }
  for (const c of cancels) {
    const target = byId.get(c.cancelEventId);
    if (target) target.status = 'CANCELLED';
    byId.delete(c.eventId);
  }

  const events = [...byId.values()]
    .filter(e => (e.status ?? 'ACTIVE') === 'ACTIVE')
    .map(e => ({
      ...e,
      eventType: String(e.eventType).toUpperCase() === 'ALIGHT' ? 'ALIGHT' : 'BOARD',
      uploadedTs: e.uploadedTs || e.ts,
    }));
  return events;
}

/**
 * 按卡号重建行程。
 * @returns { trips: Trip[], anomalies: 异常事件描述 }
 *
 * Trip:
 *  { tripId, cardId, routeId, boardEventId, alightEventId|null,
 *    boardTs, alightTs|null, boardStopId, alightStopId|null,
 *    status: 'COMPLETE'|'MISSING_ALIGHT'|'ORPHAN_ALIGHT',
 *    anomalies: [], events: [eventIds] }
 */
export function reconstructTrips(rawEvents) {
  const events = normalizeEvents(rawEvents);
  const byCard = new Map();
  for (const e of events) {
    if (!byCard.has(e.cardId)) byCard.set(e.cardId, []);
    byCard.get(e.cardId).push(e);
  }

  const trips = [];
  const anomalies = [];
  let seq = 0; // 每次重建独立计数，保证可重入

  for (const [cardId, list] of byCard) {
    list.sort((a, b) =>
      new Date(a.ts) - new Date(b.ts) ||
      (a.eventType === 'BOARD' ? -1 : 1)
    );

    let open = null; // 未闭合的上车行程
    for (const ev of list) {
      if (ev.eventType === 'BOARD') {
        if (open) {
          // 连续两次上车：前一行程缺下车记录
          open = closeMissing(open, trips, anomalies);
        }
        open = {
          tripId: `T${String(++seq).padStart(6, '0')}`,
          cardId,
          routeId: ev.routeId,
          boardEventId: ev.eventId,
          alightEventId: null,
          boardTs: ev.ts,
          alightTs: null,
          boardStopId: ev.stopId || null,
          alightStopId: null,
          status: 'MISSING_ALIGHT',
          uploadedTs: ev.uploadedTs,
          anomalies: [],
          events: [ev.eventId],
        };
      } else {
        // ALIGHT
        if (!open) {
          anomalies.push({
            type: 'ORPHAN_ALIGHT',
            cardId,
            eventId: ev.eventId,
            ts: ev.ts,
            message: `卡 ${cardId} 的下车事件 ${ev.eventId} 无对应上车记录，已忽略`,
          });
          continue;
        }
        open.alightEventId = ev.eventId;
        open.alightTs = ev.ts;
        open.alightStopId = ev.stopId || null;
        open.events.push(ev.eventId);
        if (ev.routeId && open.routeId && ev.routeId !== open.routeId) {
          open.anomalies.push({
            type: 'ROUTE_MISMATCH',
            message: `上下车线路不一致（${open.routeId}/${ev.routeId}），以上车线路计费`,
          });
        }
        open.status = 'COMPLETE';
        trips.push(open);
        open = null;
      }
    }
    if (open) closeMissing(open, trips, anomalies);
  }

  // 全量结果按上车时刻排序，便于回放
  trips.sort((a, b) => new Date(a.boardTs) - new Date(b.boardTs));
  return { trips, anomalies };
}

function closeMissing(open, trips, anomalies) {
  open.status = 'MISSING_ALIGHT';
  open.anomalies.push({
    type: 'MISSING_ALIGHT',
    message: `行程 ${open.tripId} 缺少下车记录，按缺失下车策略处理`,
  });
  anomalies.push({
    type: 'MISSING_ALIGHT',
    cardId: open.cardId,
    tripId: open.tripId,
    eventId: open.boardEventId,
    ts: open.boardTs,
    message: `卡 ${open.cardId} 行程 ${open.tripId} 缺少下车记录`,
  });
  trips.push(open);
  return null;
}

/** 受一次补传/撤销影响的卡号（重算的最小范围） */
export function affectedCardIds(prevEvents, nextEvents) {
  const ids = new Set();
  const key = e => `${e.eventId}|${e.eventType}|${e.ts}|${e.status ?? ''}`;
  const a = new Map(prevEvents.map(e => [e.eventId, key(e)]));
  const b = new Map(nextEvents.map(e => [e.eventId, key(e)]));
  for (const [id, k] of b) {
    if (a.get(id) !== k) {
      const ev = nextEvents.find(e => e.eventId === id);
      if (ev) ids.add(ev.cardId);
    }
  }
  for (const [id, k] of a) {
    if (!b.has(id)) {
      const ev = prevEvents.find(e => e.eventId === id);
      if (ev) ids.add(ev.cardId);
    }
  }
  return [...ids];
}
