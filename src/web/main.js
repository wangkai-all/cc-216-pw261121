// 应用入口：标签路由与整体重渲染
import { h, clear } from './dom.js';
import { bootstrap, persist, loadSampleData } from './app-state.js';
import { viewImport } from './views/import-view.js';
import { viewRules } from './views/rules-view.js';
import { viewReplay } from './views/replay-view.js';
import { viewRecompute } from './views/recompute-view.js';
import { viewCompare } from './views/compare-view.js';
import { viewExport } from './views/export-view.js';

const TABS = [
  ['import', '① 数据导入', viewImport],
  ['rules', '② 规则编辑', viewRules],
  ['replay', '③ 行程回放', viewReplay],
  ['recompute', '④ 重算与差额', viewRecompute],
  ['compare', '⑤ 方案对比', viewCompare],
  ['export', '⑥ 分析导出', viewExport],
];

const state = bootstrap();
let activeTab = 'import';

function rerender() {
  persist(state);
  const main = document.getElementById('view-root');
  clear(main);
  const [, , viewFn] = TABS.find(t => t[0] === activeTab);
  main.append(viewFn(state, rerender));

  document.querySelectorAll('nav.tabs button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === activeTab);
  });
}

function renderTabs() {
  const nav = document.getElementById('tab-nav');
  nav.append(...TABS.map(([key, label]) =>
    h('button', { dataset: { tab: key }, onClick: () => { activeTab = key; rerender(); } }, label),
  ));
}

// 首次进入：若为全新工作区则自动载入示例并计算，便于直接回放
if (!state.lastResult && state.events.length === 0) {
  loadSampleData(state);
}
renderTabs();
rerender();

// 暴露给需要全局重渲染的视图
window.__rerender = rerender;
