// DOM 级冒烟：用 jsdom 加载真实 index.html，驱动全部交互。
// 运行：node --test tests/dom.test.js（需要 /tmp/node_modules 下的 jsdom）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

// jsdom 为可选开发依赖，环境缺失时跳过 DOM 冒烟（核心引擎测试不受影响）
const JSDOM_PATHS = ['/tmp/node_modules/jsdom/lib/api.js'];
const jsdomPath = JSDOM_PATHS.find(p => existsSync(p));
const skip = !jsdomPath;
const { JSDOM } = skip ? {} : await import(pathToFileURL(jsdomPath).href);

function makeDom() {
  const html = readFileSync(resolve(root, 'index.html'), 'utf8');
  const dom = new JSDOM(html, {
    url: 'http://localhost:8080/index.html',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  dom.window.HTMLAnchorElement.prototype.click = function () { /* 下载在 jsdom 中无操作 */ };
  // 把 DOM 注入全局，供 ESM 入口模块使用（Node 24 下部分全局只读，需 defineProperty）
  const setGlobal = (name, value) => {
    try { global[name] = value; }
    catch { Object.defineProperty(global, name, { value, configurable: true }); }
  };
  setGlobal('window', dom.window);
  setGlobal('document', dom.window.document);
  setGlobal('navigator', dom.window.navigator);
  setGlobal('HTMLElement', dom.window.HTMLElement);
  setGlobal('Event', dom.window.Event);
  setGlobal('Blob', dom.window.Blob);
  setGlobal('URL', dom.window.URL);
  setGlobal('localStorage', dom.window.localStorage);
  return dom;
}

test('DOM 冒烟：页面加载、六标签渲染、补传/撤销/对比/导出无异常', { skip }, async () => {
  const dom = makeDom();
  const { window } = dom;

  // localStorage 存在（jsdom 默认提供）
  assert.ok(window.localStorage);

  // 以模块方式执行真实入口
  try {
    await import(pathToFileURL(resolve(root, 'src/web/main.js')).href + `?t=${Date.now()}`);
  } catch (e) {
    assert.fail(`入口模块加载失败: ${e.stack}`);
  }

  // 自动载入示例后应有内容
  const main = document.getElementById('view-root');
  assert.ok(main.innerHTML.length > 500, '首屏应渲染内容');
  const navButtons = window.document.querySelectorAll('nav.tabs button');
  assert.equal(navButtons.length, 6);

  const clickTab = name => {
    const btn = [...navButtons].find(b => b.textContent.includes(name));
    btn.dispatchEvent(new window.Event('click', { bubbles: true }));
  };

  // 逐标签切换，确保每个视图渲染不抛错
  for (const name of ['规则编辑', '行程回放', '重算与差额', '方案对比', '分析导出', '数据导入']) {
    clickTab(name);
    assert.ok(main.innerHTML.length > 100, `${name} 页应有内容`);
  }

  // 行程回放：统计卡与证据 details 存在
  clickTab('行程回放');
  assert.ok(main.textContent.includes('行程总数'));
  const details = main.querySelectorAll('details.evidence');
  assert.ok(details.length > 0, '应有可展开的计价依据');

  // 重算页：先做补传
  clickTab('重算与差额');
  const backfillBtn = [...main.querySelectorAll('button')].find(b => b.textContent.includes('离线补传'));
  assert.ok(backfillBtn && !backfillBtn.disabled);
  backfillBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
  assert.ok(main.textContent.includes('最近一次重算差额'));
  assert.ok(main.textContent.includes('BACKFILL'));

  // 再撤销
  const cancelBtn = [...main.querySelectorAll('button')].find(b => b.textContent.includes('撤销 CARD-1003'));
  cancelBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
  assert.ok(main.textContent.includes('CANCEL'));
  assert.ok(main.querySelectorAll('table').length >= 2);

  // 方案对比：运行对比并检查逐程差额表
  clickTab('方案对比');
  const runCmp = [...main.querySelectorAll('button')].find(b => b.textContent.includes('运行对比'));
  runCmp.dispatchEvent(new window.Event('click', { bubbles: true }));
  assert.ok(main.textContent.includes('总额差'));
  assert.ok(main.textContent.includes('A 最终分析扣费'));

  // 规则编辑：切换到 B 方案并修改换乘窗口，再保存重算
  clickTab('规则编辑');
  const switchB = () => [...main.querySelectorAll('.mode-switch button')].find(b => b.textContent.trim() === '方案 B');
  switchB().dispatchEvent(new window.Event('click', { bubbles: true }));
  // 点击触发整页重渲染，需重新查询节点
  assert.ok(switchB().classList.contains('active'), '方案 B 切换按钮应处于激活态');
  const saveBtn = [...main.querySelectorAll('button')].find(b => b.textContent.includes('保存并重算'));
  saveBtn.dispatchEvent(new window.Event('click', { bubbles: true }));

  // 导出页渲染
  clickTab('分析导出');
  assert.ok(main.textContent.includes('FARE_ANALYSIS_ONLY') || main.textContent.includes('导出完整分析 JSON'));

  // localStorage 已持久化
  const saved = JSON.parse(window.localStorage.getItem('bus-fare-replay-v1'));
  assert.ok(Array.isArray(saved.events) && saved.events.length > 10);
  assert.ok(saved.history.length >= 3, '应保留至少三次计算快照');

  window.close();
});
