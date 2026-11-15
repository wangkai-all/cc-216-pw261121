// 页面 1：数据导入（刷卡事件 JSON/CSV、线路票价 JSON）
import { h } from '../dom.js';
import { toast } from '../dom.js';
import { readFileAsText, downloadJson, downloadText } from '../storage.js';
import { parseEventsText, parsePolicyText } from '../import.js';
import { importEvents, loadSampleData, hardReset } from '../app-state.js';
import { toCsv } from '../../core/csv.js';
import { fmtWall } from '../dom.js';

const EVENT_CSV_HEADER = 'eventId,cardId,routeId,eventType,stopId,ts,uploadedTs,cancelEventId,source';

export function viewImport(state, rerender) {
  const tz = state.policyA.timezone;
  return h('div', {},
    h('div', { class: 'disclaimer' },
      '⚠ 本工具仅用于票价规则分析回放。所有卡号、线路、站点均为虚构数据，导出内容是分析结果而非真实扣款，系统不连接任何支付通道。'),
    h('div', { class: 'panel' },
      h('h2', {}, '快速开始'),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', onClick: () => { loadSampleData(state); toast('已载入虚构示例数据并完成首次计算', 'success'); rerender(); } }, '载入虚构示例数据'),
        h('button', { class: 'btn danger', onClick: () => { if (confirm('确认清空全部本地数据？')) { const s = hardReset(); Object.assign(state, s); toast('已重置', 'warn'); rerender(); } } }, '清空并重置'),
        h('span', { class: 'muted' }, `当前事件 ${state.events.length} 条 · 业务时区 ${tz}`),
      ),
    ),
    h('div', { class: 'panel' },
      h('h2', {}, '导入刷卡事件（JSON / CSV）'),
      h('div', { class: 'row' },
        h('label', { class: 'btn', style: 'cursor:pointer' },
          '选择事件文件…',
          h('input', { type: 'file', accept: '.json,.csv', style: 'display:none', onInput: e => handleEventFile(e, state, rerender) }),
        ),
        h('button', { class: 'btn ghost', onClick: () => downloadText('events-template.csv', EVENT_CSV_HEADER + '\r\n') }, '下载 CSV 模板'),
        h('button', { class: 'btn ghost', onClick: () => downloadJson('events-export.json', state.events) }, '导出当前事件 JSON'),
        h('button', { class: 'btn ghost', onClick: () => downloadText('events-export.csv', eventsToCsv(state.events)) }, '导出当前事件 CSV'),
      ),
      h('h3', {}, '或直接粘贴 JSON 数组 / CSV 文本'),
      h('textarea', { id: 'paste-events', rows: 6, placeholder: '[{"eventId":"EV-1","cardId":"CARD-1","routeId":"BUS-01","eventType":"BOARD","ts":"2026-11-09T08:00:00+08:00",...}]' }),
      h('div', { class: 'row', style: 'margin-top:8px' },
        h('button', { class: 'btn primary', onClick: () => handlePaste(state, rerender) }, '解析并导入'),
      ),
      h('p', { class: 'muted', style: 'margin-top:10px' },
        '字段：eventId、cardId、routeId、eventType(BOARD/ALIGHT/CANCEL)、stopId、ts(ISO8601)、uploadedTs、cancelEventId（撤销时引用原事件）。CANCEL 事件会使被引用事件失效。'),
    ),
    h('div', { class: 'panel' },
      h('h2', {}, '导入票价/优惠规则方案（JSON）'),
      h('div', { class: 'row' },
        h('label', { class: 'btn', style: 'cursor:pointer' },
          '选择规则文件…',
          h('input', { type: 'file', accept: '.json', style: 'display:none', onInput: e => handlePolicyFile(e, state, rerender) }),
        ),
        h('button', { class: 'btn ghost', onClick: () => downloadJson('policy-A.json', state.policyA) }, '导出方案 A'),
        h('button', { class: 'btn ghost', onClick: () => downloadJson('policy-B.json', state.policyB) }, '导出方案 B'),
      ),
    ),
    eventTablePanel(state, tz),
  );
}

async function handleEventFile(inputEvent, state, rerender) {
  const file = inputEvent.target.files[0];
  if (!file) return;
  try {
    const text = await readFileAsText(file);
    const { events, errors } = parseEventsText(text, file.name);
    if (errors.length) toast(`导入 ${events.length} 条，但有 ${errors.length} 个错误：${errors.slice(0, 3).join('；')}`, 'error');
    if (!events.length) return;
    const { added, duplicated } = importEvents(state, events, { kind: 'IMPORT', note: `导入文件 ${file.name}` });
    toast(`已导入 ${added} 条事件（跳过重复 ${duplicated} 条）并完成重算`, 'success');
    rerender();
  } catch (e) {
    toast(`文件解析失败：${e.message}`, 'error');
  }
  inputEvent.target.value = '';
}

function handlePaste(state, rerender) {
  const text = document.getElementById('paste-events').value.trim();
  if (!text) { toast('内容为空', 'warn'); return; }
  try {
    const { events, errors } = parseEventsText(text, 'paste.csv');
    if (errors.length) toast(errors.slice(0, 4).join('；'), 'error');
    if (!events.length) return;
    const { added } = importEvents(state, events, { kind: 'IMPORT', note: '粘贴导入' });
    toast(`已导入 ${added} 条事件并完成重算`, 'success');
    rerender();
  } catch (e) {
    toast(`解析失败：${e.message}`, 'error');
  }
}

async function handlePolicyFile(inputEvent, state, rerender) {
  const file = inputEvent.target.files[0];
  if (!file) return;
  try {
    const text = await readFileAsText(file);
    const { policy, errors } = parsePolicyText(text, state.policyA.timezone);
    if (errors.length) { toast(`规则校验问题：${errors.join('；')}`, 'error'); return; }
    const slot = state.activePolicy === 'B' ? 'policyB' : 'policyA';
    state[slot] = policy;
    toast(`已载入方案到 ${slot === 'policyA' ? 'A' : 'B'}，可在规则页编辑`, 'success');
    rerender();
  } catch (e) {
    toast(`规则文件解析失败：${e.message}`, 'error');
  }
  inputEvent.target.value = '';
}

function eventsToCsv(events) {
  const rows = [EVENT_CSV_HEADER.split(',')];
  for (const e of events) {
    rows.push([e.eventId, e.cardId, e.routeId, e.eventType, e.stopId || '', e.ts, e.uploadedTs || '', e.cancelEventId || '', e.source || '']);
  }
  return toCsv(rows);
}

function eventTablePanel(state, tz) {
  const events = [...state.events].sort((a, b) => new Date(a.ts) - new Date(b.ts));
  if (!events.length) return h('div', { class: 'panel' }, h('p', { class: 'muted' }, '尚未导入任何事件'));
  return h('div', { class: 'panel' },
    h('h2', {}, `事件清单（${events.length} 条，按发生时间）`),
    h('div', { class: 'scroll-x' }, h('table', {},
      h('thead', {}, h('tr', {},
        h('th', {}, '事件ID'), h('th', {}, '卡号'), h('th', {}, '线路'),
        h('th', {}, '类型'), h('th', {}, '站点'),
        h('th', {}, '发生时间（业务时区）'), h('th', {}, '上传时间'), h('th', {}, '来源'),
      )),
      h('tbody', {}, events.map(e => h('tr', {},
        h('td', { class: 'mono' }, e.eventId),
        h('td', { class: 'mono' }, e.cardId),
        h('td', { class: 'mono' }, e.routeId),
        h('td', {}, h('span', { class: `pill ${e.eventType === 'CANCEL' ? 'red' : e.eventType === 'BOARD' ? 'blue' : 'cyan'}` }, e.eventType)),
        h('td', { class: 'mono' }, e.stopId || '—'),
        h('td', { class: 'mono' }, fmtWall(e.ts, tz)),
        h('td', { class: 'mono' }, e.uploadedTs && e.uploadedTs > e.ts ? fmtWall(e.uploadedTs, tz) : '实时'),
        h('td', {}, e.source || ''),
      ))),
    )),
  );
}
