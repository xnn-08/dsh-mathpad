/**
 * Smoke test for the client half of dsh-mathpad.
 * Fakes the module loader and React; drives the dock trigger + shell.overlay
 * panel and checks the 0.6.0 information architecture:
 *   5 tabs, permanent recent bar, symbol/template areas, bottom edit bar,
 *   number popover, fill-in page (lim / int / sum / prod), LaTeX mapping.
 *
 * Run with the DSH runtime:
 *   $env:ELECTRON_RUN_AS_NODE='1'; & $env:DSH_NODE_EXECUTABLE .\test\smoke.mjs
 */
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert';

const file = new URL('../client.js', import.meta.url);
const code = fs.readFileSync(file, 'utf8');
const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

// ---- minimal React --------------------------------------------------------
const hookState = { slots: [], use: 0 };
function resetHooks() { hookState.slots = []; hookState.use = 0; }

const React = {
  Fragment: Symbol('Fragment'),
  createElement(type, props, ...children) {
    return { type, props: props ?? {}, children: children.length === 1 ? children[0] : children };
  },
  useState(initial) {
    const index = hookState.use++;
    if (hookState.slots.length <= index) hookState.slots.push(initial);
    const set = (value) => {
      hookState.slots[index] = typeof value === 'function' ? value(hookState.slots[index]) : value;
    };
    return [hookState.slots[index], set];
  },
  useRef(initial) { return { current: initial }; },
  useEffect(fn) { fn(); },
  useCallback(fn) { return fn; },
};

// ---- minimal browser surface ----------------------------------------------
let registered = null;
const domListeners = [];
const window = { __ModuleLoader__: { load(def) { registered = def; } } };

const installedStyles = [];
const storage = new Map();
const context = vm.createContext({
  window,
  console,
  setTimeout,
  clearTimeout,
  document: {
    activeElement: null,
    head: { appendChild(node) { installedStyles.push(node); } },
    createElement(tag) { return { tagName: tag, dataset: {}, textContent: '', remove() {} }; },
    addEventListener(type, fn) { domListeners.push({ type, fn }); },
    removeEventListener(type, fn) {
      const index = domListeners.findIndex((entry) => entry.type === type && entry.fn === fn);
      if (index >= 0) domListeners.splice(index, 1);
    },
  },
  localStorage: {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => { storage.set(key, String(value)); },
  },
  navigator: { clipboard: { writeText: async () => {} } },
});
context.require = (name) => {
  if (name === 'react') return React;
  throw new Error('unexpected require: ' + name);
};
vm.runInContext(code, context);

assert.ok(registered !== null, 'module loader was not called');
assert.strictEqual(registered.id, 'dsh-mathpad');
assert.strictEqual(pkg.version, '0.6.1', 'package.json version must match the client');

const plugin = registered.factory(context.require);
assert.ok(plugin && typeof plugin.apply === 'function', 'plugin.apply missing');
assert.ok(plugin.inject.includes('slots'), 'plugin.inject must include slots');

// ---- capture both registrations -------------------------------------------
const registrations = new Map();
plugin.apply({
  effect(fn) { return fn(); },
  slots: {
    inject(name, fn) { fn(); },
    register(options, component) { registrations.set(options.id, { options, component }); return () => {}; },
  },
});

assert.deepStrictEqual([...registrations.keys()].sort(), ['math-symbols', 'math-symbols-panel']);
assert.strictEqual(registrations.get('math-symbols').options.name, 'conversation.input.right');
assert.strictEqual(registrations.get('math-symbols-panel').options.name, 'shell.overlay');

assert.strictEqual(installedStyles.length, 1, 'styles must be installed once from apply');
const css = installedStyles[0].textContent;
assert.ok(css.includes('.mss-trigger'), 'trigger styles must be present in the installed sheet');
assert.ok(css.includes('.mss-tabs'), 'tab styles must be installed');
assert.ok(css.includes('.mss-cells{display:grid;grid-template-columns:repeat(6'), 'grids are 6 columns wide');
assert.ok(css.includes('.mss-tplgrid{border:1px dashed'), 'template area must be a dashed box');
assert.ok(css.includes('.mss-numpop{position:absolute'), 'number popover must be positioned');
assert.ok(css.includes('.mss-numpop') && css.includes('bottom:calc(100% + 8px)'), 'number popover anchors above its button');
assert.ok(css.includes('.mss-recent-cells{grid-template-columns:repeat(6'), 'recent bar must be 6 columns wide');

const render = (id, props) => {
  resetHooks();
  return registrations.get(id).component(props ?? {});
};

function find(node, predicate, out = []) {
  if (node === null || node === undefined) return out;
  if (Array.isArray(node)) { for (const child of node) find(child, predicate, out); return out; }
  if (typeof node === 'string' || typeof node === 'number') return out;
  if (predicate(node)) out.push(node);
  if (node.children !== undefined) find(node.children, predicate, out);
  return out;
}
const textOf = (node) => {
  if (node === null || node === undefined) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  return textOf(node.children);
};
const hasClass = (node, name) => Boolean(node && node.props && typeof node.props.className === 'string'
  && node.props.className.split(' ').includes(name));
const nodeListOf = (tree, name) => find(tree, (node) => hasClass(node, name));

// ---- panel helpers --------------------------------------------------------
let dialog = null;
let calls = [];
const inputActions = {
  captureInsertion: () => ({ draftRev: 7 }),
  insertText: (text, span) => { calls.push({ text, span }); return true; },
};

const drawPanel = () => {
  dialog = render('math-symbols-panel');
  return dialog;
};
const openPanel = () => {
  render('math-symbols', { inputActions }).props.onClick();
  drawPanel();
  assert.ok(dialog !== null, 'panel must open');
};
const activeTab = () => {
  const tab = find(dialog, (node) => hasClass(node, 'mss-tab-on'))[0];
  return tab === undefined ? null : textOf(tab);
};
const clickTab = (name) => {
  const tab = find(dialog, (node) => hasClass(node, 'mss-tab') && textOf(node) === name)[0];
  assert.ok(tab, 'tab missing: ' + name);
  tab.props.onClick();
  drawPanel();
};
const isCellNode = (node) => hasClass(node, 'mss-cell') && !hasClass(node, 'mss-toggle')
  && !hasClass(node, 'mss-recent-cell') && !hasClass(node, 'mss-letter-cell');
const cellsOf = () => find(dialog, isCellNode);
const gridOf = (name) => find(dialog, (node) => {
  if (!hasClass(node, 'mss-cells')) return false;
  if (name === 'symbols') return !hasClass(node, 'mss-tplgrid') && !hasClass(node, 'mss-letters') && !hasClass(node, 'mss-recent-cells');
  return hasClass(node, name);
})[0];
const symbolCells = () => {
  const grid = gridOf('symbols');
  return grid === undefined ? [] : find(grid, isCellNode);
};
const templateCells = () => {
  const grid = gridOf('mss-tplgrid');
  return grid === undefined ? [] : find(grid, isCellNode);
};
const cell = (text) => find(dialog, (node) => isCellNode(node) && node.props.title === '插入 ' + text)[0];
const clickCell = (text) => {
  const button = cell(text);
  assert.ok(button, 'cell missing: ' + text + ' (tab ' + activeTab() + ')');
  button.props.onClick();
  drawPanel();
};
const bottomKey = (label) => find(dialog, (node) => hasClass(node, 'mss-key') && textOf(node) === label)[0];
const clickBottom = (label) => {
  const key = bottomKey(label);
  assert.ok(key, 'bottom key missing: ' + label);
  key.props.onClick();
  drawPanel();
};
const numKeys = () => nodeListOf(dialog, 'mss-numkey');
const clickNum = (char) => {
  const key = numKeys().find((node) => textOf(node) === char);
  assert.ok(key, 'number key missing: ' + char);
  key.props.onClick();
  drawPanel();
};
const draftValue = () => {
  const input = nodeListOf(dialog, 'mss-draftinput')[0];
  return input === undefined ? null : input.props.value;
};
const setDraft = (value, caret) => {
  const input = nodeListOf(dialog, 'mss-draftinput')[0];
  assert.ok(input, 'draft input missing');
  input.props.onChange({ target: { value, selectionStart: caret === undefined ? value.length : caret } });
  drawPanel();
};
const preview = () => textOf(nodeListOf(dialog, 'mss-math')[0]);
const press = (key, extra) => {
  nodeListOf(dialog, 'mss-scrim')[0].props.onKeyDown({ key, preventDefault() {}, stopPropagation() {}, ...(extra ?? {}) });
  drawPanel();
};
const modeButton = (label) => find(dialog, (node) => hasClass(node, 'mss-mode') && textOf(node) === label)[0];
const latexOn = () => find(dialog, (node) => hasClass(node, 'mss-lbl') && textOf(node) === 'LaTeX').length > 0;
const setLatex = (on) => {
  if (latexOn() === on) return;
  const button = modeButton(on ? 'TeX' : 'TeX ✓');
  assert.ok(button, 'TeX toggle missing');
  button.props.onClick();
  drawPanel();
};
const slotPage = () => nodeListOf(dialog, 'mss-slotpage')[0];
const slotInputs = () => nodeListOf(dialog, 'mss-slotinput');
const slotCaps = () => nodeListOf(dialog, 'mss-slotcap').map(textOf);
const insertPrimary = () => find(dialog, (node) => hasClass(node, 'mss-btn') && hasClass(node, 'mss-btn-primary'))[0];

// ---- before opening: no dialog -------------------------------------------
assert.strictEqual(render('math-symbols-panel'), null, 'panel renders nothing while closed');

// ---- trigger carries the G2 frame ----------------------------------------
const triggerNode = render('math-symbols', { inputActions });
const frameSvg = find(triggerNode, (node) => node.props && node.props.className === 'mss-frame')[0];
assert.ok(frameSvg, 'frame svg missing');
const framePaths = find(frameSvg, (node) => node.type === 'path');
assert.strictEqual(framePaths.length, 2, 'frame needs a fill path and a line path');
const frameD = framePaths[0].props.d;
assert.ok(frameD.startsWith('M '), 'frame path must start with a move');
assert.ok(frameD.endsWith(' Z'), 'frame path must be closed');
assert.ok(frameD.split(' L ').length > 100, 'frame path must be smoothly sampled');

// ---- trigger opens the panel ---------------------------------------------
const trigger = render('math-symbols', { inputActions });
assert.strictEqual(trigger.type, 'div');
assert.strictEqual(trigger.props.role, 'button');
trigger.props.onClick();
drawPanel();
assert.ok(dialog !== null, 'panel must open after the trigger click');

const versionTag = find(dialog, (node) => node.props && node.props.className === 'mss-version')[0];
assert.ok(versionTag, 'panel must show its version so a stale module is obvious');
assert.strictEqual(textOf(versionTag), 'v0.6.1', 'version tag must be v0.6.1');

// ---- 5 tabs --------------------------------------------------------------
const tabLabels = nodeListOf(dialog, 'mss-tab').map(textOf);
assert.deepStrictEqual(tabLabels, ['变量/常量', '运算/结构', '函数', '希腊字母', '微积分'], 'expected 5 tabs');
assert.strictEqual(activeTab(), '变量/常量', 'vars is the default tab');
assert.strictEqual(nodeListOf(dialog, 'mss-tab').filter((node) => hasClass(node, 'mss-tab-on')).length, 1,
  'exactly one tab is highlighted');

// ---- vars tab: symbols only, no template area ---------------------------
const sectionLabels = () => nodeListOf(dialog, 'mss-sect').map((block) => textOf(find(block, (node) => hasClass(node, 'mss-sname'))[0]));
assert.deepStrictEqual(sectionLabels(), ['符号'], 'a tab without templates shows only the symbol area');
assert.strictEqual(symbolCells().length, 10, 'vars tab has 10 symbols');
assert.strictEqual(templateCells().length, 0);
assert.strictEqual(gridOf('mss-tplgrid'), undefined, 'empty template area must not render');
assert.strictEqual(nodeListOf(dialog, 'mss-recent').length, 0, 'recent bar is hidden while empty');
const varsTitles = symbolCells().map((node) => node.props.title);
assert.deepStrictEqual(varsTitles, ['插入 x', '插入 y', '插入 z', '插入 a', '插入 b', '插入 n', '插入 t', '插入 π', '插入 e', '插入 ∞']);
assert.ok(!varsTitles.includes('插入 θ'), 'θ moved to the greek tab');

clickCell('x');
assert.strictEqual(draftValue(), 'x');
assert.strictEqual(preview(), 'x');
clickCell('π');
assert.strictEqual(draftValue(), 'xπ', 'symbols insert at the caret/end of the draft');

// a–z letter strip stays on the vars tab
find(dialog, (node) => hasClass(node, 'mss-toggle'))[0].props.onClick();
drawPanel();
assert.strictEqual(nodeListOf(dialog, 'mss-letter-cell').length, 26, 'letters strip adds 26 cells');
assert.strictEqual(symbolCells().length, 10, 'letter strip does not count as symbols');
setDraft('', 0);
find(dialog, (node) => hasClass(node, 'mss-letter-cell') && node.props.title === '插入 a')[0].props.onClick();
drawPanel();
assert.strictEqual(draftValue(), 'a', 'letter a inserted');
find(dialog, (node) => hasClass(node, 'mss-toggle'))[0].props.onClick();
drawPanel();
assert.strictEqual(nodeListOf(dialog, 'mss-letter-cell').length, 0, 'letters strip collapses again');

// ---- ops tab: symbols + dashed template grid ----------------------------
clickTab('运算/结构');
assert.strictEqual(activeTab(), '运算/结构');
assert.deepStrictEqual(sectionLabels(), ['符号', '模板'], 'symbol area then template area');
assert.strictEqual(symbolCells().length, 13, 'ops tab has 13 symbols');
assert.strictEqual(templateCells().length, 5, 'ops tab has 5 templates');
const opsTitles = symbolCells().map((node) => node.props.title);
assert.deepStrictEqual(opsTitles,
  ['插入 +', '插入 -', '插入 *', '插入 ÷', '插入 =', '插入 (', '插入 )', '插入 [', '插入 ]',
    '插入 ±', '插入 ≠', '插入 ≤', '插入 ≥']);
const tplTitles = templateCells().map((node) => node.props.title);
assert.deepStrictEqual(tplTitles, ['插入 x²', '插入 x³', '插入 √', '插入 √[]()', '插入 ( )/( )']);
assert.ok(templateCells().every((node) => hasClass(node, 'mss-cell-tpl')), 'template cells carry the template marker');

// operators insert their own characters (÷ no longer shares '/' with the slash symbol)
setDraft('', 0);
clickCell('+');
clickCell('*');
clickCell('÷');
clickBottom('/');
assert.strictEqual(draftValue(), '+*÷/', 'slash comes from the bottom bar');
clickCell('±');
clickCell('≠');
clickCell('≤');
clickCell('≥');
assert.strictEqual(draftValue(), '+*÷/±≠≤≥');

// ---- templates: offsets put the caret inside the shape ------------------
setDraft('', 0);
clickCell('x²');
assert.strictEqual(draftValue(), 'x²');
setDraft('', 0);
clickCell('√[]()');
assert.strictEqual(draftValue(), '√[]()');
clickBottom('/');
assert.strictEqual(draftValue(), '√[/]()', 'template offset puts the caret inside the brackets');
setDraft('', 0);
clickCell('( )/( )');
assert.strictEqual(draftValue(), '( )/( )');
clickBottom('/');
assert.strictEqual(draftValue(), '( /)/( )', 'fraction template puts the caret in the numerator');

// ---- ⁿ superscript toggle lives in the ops template area ----------------
const supToggle = find(dialog, (node) => hasClass(node, 'mss-toggle'))[0];
assert.ok(supToggle, 'superscript toggle missing from the template area');
supToggle.props.onClick();
drawPanel();
const supRow = nodeListOf(dialog, 'mss-suprow')[0];
assert.ok(supRow, 'superscript row appears next to the template area');
assert.deepStrictEqual(find(supRow, (node) => hasClass(node, 'mss-key')).map(textOf),
  ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹', 'ⁿ']);
setDraft('', 0);
const supTwo = find(supRow, (node) => hasClass(node, 'mss-key') && textOf(node) === '²')[0];
assert.ok(supTwo, 'superscript ² button present');
supTwo.props.onClick();
drawPanel();
assert.strictEqual(draftValue(), '²', 'superscript row inserts unicode superscripts');
find(dialog, (node) => hasClass(node, 'mss-toggle'))[0].props.onClick();
drawPanel();
assert.strictEqual(nodeListOf(dialog, 'mss-suprow').length, 0, 'superscript row collapses');

// ---- fn tab --------------------------------------------------------------
clickTab('函数');
assert.strictEqual(sectionLabels().length, 1);
assert.strictEqual(symbolCells().length, 11, 'fn tab has 11 functions');
const fnTitles = symbolCells().map((node) => node.props.title);
assert.deepStrictEqual(fnTitles,
  ['插入 sin', '插入 cos', '插入 tan', '插入 cot', '插入 sec', '插入 csc',
    '插入 arcsin', '插入 arccos', '插入 arctan', '插入 ln', '插入 log']);
assert.ok(fnTitles.includes('插入 log'), 'log is a first-class function');
setDraft('', 0);
clickCell('log');
assert.strictEqual(draftValue(), 'log');

// ---- greek tab (π stays in vars) ---------------------------------------
clickTab('希腊字母');
assert.strictEqual(symbolCells().length, 31, 'greek tab has 21 lower + 10 upper');
const greekTitles = symbolCells().map((node) => node.props.title);
assert.ok(greekTitles.includes('插入 θ'), 'θ moved here');
assert.ok(!greekTitles.includes('插入 π'), 'π stays in vars');
assert.ok(greekTitles.includes('插入 α') && greekTitles.includes('插入 ω'));
assert.ok(greekTitles.includes('插入 Γ') && greekTitles.includes('插入 Ω'));
assert.strictEqual(templateCells().length, 0);
setDraft('', 0);
clickCell('θ');
assert.strictEqual(draftValue(), 'θ');

// ---- calc tab ------------------------------------------------------------
clickTab('微积分');
assert.strictEqual(symbolCells().length, 6, 'calc tab has 6 symbols');
assert.strictEqual(templateCells().length, 4, 'calc tab has 4 templates');
assert.deepStrictEqual(symbolCells().map((node) => node.props.title),
  ['插入 ∫', '插入 ∮', '插入 ∂', '插入 d', '插入 ∇', '插入 →']);
assert.deepStrictEqual(templateCells().map((node) => node.props.title),
  ['插入 ∫_()^()', '插入 lim()→()', '插入 ∑_()^()', '插入 ∏_()^()']);

// every symbol/template lives in exactly one tab (the recent strip is the only repeat surface)
const allCellTitles = [];
for (const name of ['变量/常量', '运算/结构', '函数', '希腊字母', '微积分']) {
  clickTab(name);
  allCellTitles.push(...cellsOf().map((node) => node.props.title));
}
assert.strictEqual(allCellTitles.length, 10 + 18 + 11 + 31 + 10, 'total cells across the 5 tabs');
assert.strictEqual(new Set(allCellTitles).size, allCellTitles.length, 'symbols/templates are globally unique');

// ---- bottom edit bar: clear / space ------------------------------------
setDraft('sinx', 4);
clickBottom('清空');
assert.strictEqual(draftValue(), '', '清空 clears the draft');
setDraft('a', 1);
clickBottom('空格');
assert.strictEqual(draftValue(), 'a ', '空格 inserts a plain space');
assert.strictEqual(textOf(bottomKey('空格')), '空格');
assert.strictEqual(nodeListOf(dialog, 'mss-search').length, 0, 'the old search box stays gone');

// ---- bottom edit bar: ← / → move the caret by one character -------------
clickTab('变量/常量');
setDraft('ab', 2);
clickBottom('←');
assert.strictEqual(draftValue(), 'ab', '← only moves the caret');
clickCell('x');
assert.strictEqual(draftValue(), 'axb', '← moved the caret one character left');
clickBottom('→');
clickCell('y');
assert.strictEqual(draftValue(), 'axby', '→ moved the caret one character right, got ' + draftValue());
setDraft('ab', 2);
clickBottom('→');
clickCell('x');
assert.strictEqual(draftValue(), 'abx', '→ clamps at the end of the draft');
setDraft('ab', 0);
clickBottom('←');
clickCell('x');
assert.strictEqual(draftValue(), 'xab', '← clamps at the start of the draft');

// ---- bottom edit bar: number popover -----------------------------------
setDraft('', 0);
clickBottom('数字');
assert.ok(nodeListOf(dialog, 'mss-numpop')[0], '数字 opens the popover');
assert.ok(hasClass(bottomKey('数字'), 'mss-key-on'), '数字 is highlighted while open');
assert.deepStrictEqual(numKeys().map(textOf), ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '.', '/'],
  'popover is 1-9, 0, ., / (3 columns x 4 rows)');
assert.ok(css.includes('.mss-numpop') && css.includes('grid-template-columns:repeat(3'), 'popover is a 3-column grid');
clickBottom('数字');
assert.strictEqual(nodeListOf(dialog, 'mss-numpop').length, 0, 'clicking 数字 again closes the popover');
assert.ok(!hasClass(bottomKey('数字'), 'mss-key-on'), '数字 loses its highlight when closed');
clickBottom('数字');
clickNum('1');
clickNum('2');
clickNum('.');
clickNum('5');
clickNum('/');
assert.strictEqual(draftValue(), '12.5/', 'number keys insert at the caret');
setDraft('ab', 1);
clickNum('3');
assert.strictEqual(draftValue(), 'a3b', 'number keys insert at the current caret');

// outside click closes the popover
const outsideListener = domListeners.filter((entry) => entry.type === 'mousedown').pop();
assert.ok(outsideListener, 'an outside-click listener is registered while the popover is open');
outsideListener.fn({ target: {} });
drawPanel();
assert.strictEqual(nodeListOf(dialog, 'mss-numpop').length, 0, 'outside click closes the number popover');
assert.ok(!hasClass(bottomKey('数字'), 'mss-key-on'), '数字 loses its highlight');

// Esc closes the popover first, the panel stays open
clickBottom('数字');
press('Escape');
assert.strictEqual(nodeListOf(dialog, 'mss-numpop').length, 0, 'Esc closes the number popover');
assert.ok(nodeListOf(dialog, 'mss-dialog')[0], 'panel stays open after closing the popover');

// Tab switches tabs and never moves focus into the popover
clickBottom('数字');
assert.ok(nodeListOf(dialog, 'mss-numpop')[0], 'popover reopened');
press('Tab');
assert.strictEqual(activeTab(), '运算/结构', 'Tab switches to the next tab');
assert.strictEqual(nodeListOf(dialog, 'mss-numpop').length, 0, 'Tab does not land in the number popover');

// ---- hover selects, arrows move, Enter outputs --------------------------
clickTab('变量/常量');
setDraft('', 0);
press('ArrowRight');
let focused = find(dialog, (node) => hasClass(node, 'mss-cell-focus'))[0];
assert.ok(focused, 'ArrowRight selects a cell');
assert.strictEqual(focused.props.title, '插入 y', 'ArrowRight moves from x to y, got ' + focused.props.title);
press('Enter');
assert.strictEqual(draftValue(), 'y', 'Enter outputs the selected cell, got ' + draftValue());

find(dialog, (node) => hasClass(node, 'mss-sect'))[0].props.onMouseEnter();
drawPanel();
focused = find(dialog, (node) => hasClass(node, 'mss-cell-focus'))[0];
assert.strictEqual(focused.props.title, '插入 x', 'hovering the symbol area selects the first symbol');
press('ArrowDown');
focused = find(dialog, (node) => hasClass(node, 'mss-cell-focus'))[0];
assert.strictEqual(focused.props.title, '插入 t', 'ArrowDown moves a full 6-column row, got ' + focused.props.title);
nodeListOf(dialog, 'mss-body')[0].props.onMouseLeave();
drawPanel();
assert.strictEqual(find(dialog, (node) => hasClass(node, 'mss-cell-focus')).length, 0,
  'silent when the pointer leaves the grid');

// templates join the same navigation list as symbols
clickTab('运算/结构');
for (let step = 0; step < 13; step += 1) press('ArrowRight');
focused = find(dialog, (node) => hasClass(node, 'mss-cell-focus'))[0];
assert.strictEqual(focused.props.title, '插入 x²', 'arrow keys cross from symbols into the template area');
press('ArrowLeft');
focused = find(dialog, (node) => hasClass(node, 'mss-cell-focus'))[0];
assert.strictEqual(focused.props.title, '插入 ≥', 'ArrowLeft goes back to the last symbol');
setDraft('', 0);
press('ArrowRight');
press('Enter');
assert.strictEqual(draftValue(), 'x²', 'Enter outputs the focused template, got ' + draftValue());

// Tab cycles the 5 tabs and resets the in-tab focus
const tabOrder = ['函数', '希腊字母', '微积分', '变量/常量', '运算/结构'];
for (const expected of tabOrder) {
  press('Tab');
  assert.strictEqual(activeTab(), expected, 'Tab cycles tabs, expected ' + expected);
  assert.strictEqual(find(dialog, (node) => hasClass(node, 'mss-cell-focus')).length, 0,
    'switching tabs resets the focus ring');
}

// draft input Enter does not swallow the selected cell
clickTab('变量/常量');
setDraft('', 0);
press('ArrowRight');
nodeListOf(dialog, 'mss-draftinput')[0].props.onKeyDown({ key: 'Enter', preventDefault() {}, stopPropagation() {} });
drawPanel();
assert.strictEqual(draftValue(), 'y', 'Enter inside the draft outputs the selected cell, got ' + draftValue());

// pointer inside the draft lets the arrow keys edit the caret instead
find(dialog, (node) => hasClass(node, 'mss-draft'))[0].props.onMouseEnter();
drawPanel();
const beforeArrow = find(dialog, (node) => hasClass(node, 'mss-cell-focus'))[0];
press('ArrowRight');
const afterArrow = find(dialog, (node) => hasClass(node, 'mss-cell-focus'))[0];
assert.strictEqual(afterArrow.props.title, beforeArrow.props.title,
  'arrow keys do not move the grid while the pointer is in the draft');
find(dialog, (node) => hasClass(node, 'mss-draft'))[0].props.onMouseLeave();
drawPanel();

// Shift+Tab still toggles TeX
press('Tab', { shiftKey: true });
assert.ok(latexOn(), 'Shift+Tab turns LaTeX on');
press('Tab', { shiftKey: true });
assert.ok(!latexOn(), 'Shift+Tab turns LaTeX off again');

// Enter with an empty draft keeps the panel open
setDraft('', 0);
nodeListOf(dialog, 'mss-body')[0].props.onMouseLeave();
drawPanel();
press('Enter');
assert.ok(dialog !== null, 'Enter with an empty draft keeps the panel open');

// ---- multi-character symbols delete as one token -------------------------
setDraft('sinx', 3);
clickBottom('⌫ 删除');
assert.strictEqual(draftValue(), 'x', 'backspace removes the whole sin token, got ' + draftValue());

setDraft('lim', 3);
clickBottom('⌫ 删除');
assert.strictEqual(draftValue(), '', 'backspace removes the whole lim token, got ' + draftValue());

setDraft('asin', 4);
clickBottom('⌫ 删除');
assert.strictEqual(draftValue(), 'a', 'asin is tokenized as a + sin, got ' + draftValue());

setDraft('limcosx', 7);
clickBottom('⌫ 删除');
assert.strictEqual(draftValue(), 'limcos', 'composite: x removed, got ' + draftValue());
setDraft('limcos', 6);
clickBottom('⌫ 删除');
assert.strictEqual(draftValue(), 'lim', 'composite: cos removed as one token, got ' + draftValue());

setDraft('arcsinsin', 9);
clickBottom('⌫ 删除');
assert.strictEqual(draftValue(), 'arcsin', 'composite: trailing sin removed as one token, got ' + draftValue());

setDraft('lim(x)→(0)', 11);
clickBottom('⌫ 删除');
assert.strictEqual(draftValue(), 'lim', 'filled lim deletes its content as one subject, got ' + draftValue());
clickBottom('⌫ 删除');
assert.strictEqual(draftValue(), '', 'second delete removes lim itself, got ' + draftValue());

setDraft('∫_(0)^(1)', 9);
clickBottom('⌫ 删除');
assert.strictEqual(draftValue(), '∫', 'filled integral keeps the sign after one delete, got ' + draftValue());

setDraft('∑_(a)^(b)', 9);
clickBottom('⌫ 删除');
assert.strictEqual(draftValue(), '∑', 'filled sum deletes its bounds as one subject, got ' + draftValue());
clickBottom('⌫ 删除');
assert.strictEqual(draftValue(), '', 'second delete removes the sum sign, got ' + draftValue());

setDraft('∏_(a)^(b)', 9);
clickBottom('⌫ 删除');
assert.strictEqual(draftValue(), '∏', 'filled product deletes its bounds as one subject, got ' + draftValue());

setDraft('ln', 2);
let prevented = false;
nodeListOf(dialog, 'mss-draftinput')[0].props.onKeyDown({
  key: 'Backspace',
  currentTarget: { selectionStart: 2, selectionEnd: 2 },
  preventDefault: () => { prevented = true; },
  stopPropagation: () => {},
});
drawPanel();
assert.ok(prevented, 'token backspace prevents the native single-char delete');
assert.strictEqual(draftValue(), '', 'input backspace removes the whole ln token, got ' + draftValue());

// ---- fill-in page: lim ---------------------------------------------------
clickTab('微积分');
setDraft('', 0);
clickCell('lim()→()');
assert.ok(slotPage(), 'lim template opens the fill-in page');
assert.strictEqual(textOf(nodeListOf(dialog, 'mss-slottitle')[0]), 'lim 模板');
assert.deepStrictEqual(slotCaps(), ['极限点', '趋向']);
assert.strictEqual(textOf(nodeListOf(dialog, 'mss-slotlabel')[0]), 'lim');
assert.strictEqual(nodeListOf(dialog, 'mss-slotkey').length, 10 + 10, 'fill-in grid keeps vars + 0-9');
assert.strictEqual(slotInputs().length, 2, 'two slot inputs are visible at once');
slotInputs()[0].props.onChange({ target: { value: 'x' } });
drawPanel();
slotInputs()[1].props.onChange({ target: { value: '0' } });
drawPanel();
slotInputs()[1].props.onKeyDown({ key: 'Enter', preventDefault() {}, stopPropagation() {} });
drawPanel();
assert.strictEqual(slotPage(), undefined, 'slot page closes after the last Enter');
assert.strictEqual(draftValue(), 'lim(x)→(0)', 'filled lim template inserted, got ' + draftValue());

// clicking the blank area of the fill-in page commits (even when empty)
setDraft('', 0);
clickCell('lim()→()');
const page = slotPage();
const slotGrid = nodeListOf(dialog, 'mss-slotgrid')[0];
page.props.onMouseDown({ target: slotGrid, currentTarget: page });
drawPanel();
assert.strictEqual(slotPage(), undefined, 'blank click closes the fill-in page');
assert.strictEqual(draftValue(), 'lim()→()', 'blank click with empty slots inserts the base template, got ' + draftValue());
assert.ok(nodeListOf(dialog, 'mss-dialog')[0], 'main panel stays open after blank click');

// clicking a slot key keeps the page alive
clickCell('lim()→()');
nodeListOf(dialog, 'mss-slotkey')[0].props.onClick();
drawPanel();
assert.ok(slotPage(), 'slot page survives a keypad click');
press('Escape');
assert.strictEqual(slotPage(), undefined, 'Escape leaves the slot page');
assert.ok(nodeListOf(dialog, 'mss-dialog')[0], 'panel stays open after leaving the slot page');

// ---- fill-in page: sum / product ----------------------------------------
setDraft('', 0);
clickCell('∑_()^()');
assert.ok(slotPage(), 'sum template opens the fill-in page');
assert.strictEqual(textOf(nodeListOf(dialog, 'mss-slottitle')[0]), '求和上下限');
assert.deepStrictEqual(slotCaps(), ['下限', '上限'], 'sum uses 下限/上限 labels');
assert.strictEqual(textOf(nodeListOf(dialog, 'mss-slotlabel')[0]), '∑');
slotInputs()[0].props.onChange({ target: { value: 'a' } });
drawPanel();
slotInputs()[1].props.onChange({ target: { value: 'b' } });
drawPanel();
slotInputs()[1].props.onKeyDown({ key: 'Enter', preventDefault() {}, stopPropagation() {} });
drawPanel();
assert.strictEqual(draftValue(), '∑_(a)^(b)', 'filled sum inserts ∑_(a)^(b), got ' + draftValue());

setDraft('', 0);
clickCell('∏_()^()');
assert.ok(slotPage(), 'product template opens the fill-in page');
assert.strictEqual(textOf(nodeListOf(dialog, 'mss-slottitle')[0]), '连乘上下限');
assert.deepStrictEqual(slotCaps(), ['下限', '上限']);
slotInputs()[0].props.onChange({ target: { value: 'a' } });
drawPanel();
slotInputs()[1].props.onChange({ target: { value: 'b' } });
drawPanel();
slotInputs()[1].props.onKeyDown({ key: 'Enter', preventDefault() {}, stopPropagation() {} });
drawPanel();
assert.strictEqual(draftValue(), '∏_(a)^(b)', 'filled product inserts ∏_(a)^(b), got ' + draftValue());

// ---- LaTeX ---------------------------------------------------------------
setLatex(true);
assert.strictEqual(preview(), '\\prod_{a}^{b}', 'product LaTeX, got ' + preview());

const cases = [
  ['x²', 'x^{2}', 'superscript'],
  ['sinx', '\\sin x', 'function spacing'],
  ['limx→0 sinx', '\\lim_{x \\to 0} \\sin x', 'lim + function'],
  ['lim(x)→(0)', '\\lim_{x \\to 0}', 'filled lim template'],
  ['∫_(0)^(1)', '\\int_{0}^{1}', 'integral bounds'],
  ['∑_(a)^(b)', '\\sum_{a}^{b}', 'sum fill'],
  ['∑_()^()', '\\sum_{}^{}', 'empty sum'],
  ['∏_(a)^(b)', '\\prod_{a}^{b}', 'product fill'],
  ['∏_()^()', '\\prod_{}^{}', 'empty product'],
  ['∑', '\\sum', 'bare sum keeps the old TeX mapping'],
  ['∏', '\\prod', 'bare product keeps the old TeX mapping'],
  ['∐', '\\coprod', 'legacy coproduct keeps its TeX mapping'],
  ['√[3](x)', '\\sqrt[3]{x}', 'nth root'],
  ['(sinx)/(1+sinx)', '\\frac{\\sin x}{1+\\sin x}', 'fraction'],
  ['(1)/(2)', '\\frac{1}{2}', 'slash inside the fraction template'],
  ['1/2', '1/2', 'bare slash stays a slash'],
  ['±', '\\pm', 'plus-minus'],
  ['≠', '\\neq', 'not equal'],
  ['≤', '\\leq', 'less-or-equal'],
  ['≥', '\\geq', 'greater-or-equal'],
  ['÷', '\\div', 'division sign'],
  ['α', '\\alpha', 'lower greek'],
  ['Γ', '\\Gamma', 'upper greek'],
  ['θ', '\\theta', 'theta'],
  ['logx', '\\log x', 'log function'],
];
for (const [raw, tex, label] of cases) {
  setDraft(raw, raw.length);
  assert.strictEqual(preview(), tex, label + ': ' + raw + ' -> ' + tex + ', got ' + preview());
  assert.ok(!preview().includes('\\\\sin'), 'function names must not be double escaped');
}

// inserting in TeX mode sends the converted draft exactly once
setDraft('(sinx)/(1+sinx)', 16);
const beforeTex = calls.length;
insertPrimary().props.onClick();
assert.strictEqual(calls.length, beforeTex + 1);
assert.strictEqual(calls[calls.length - 1].text, '\\frac{\\sin x}{1+\\sin x}');
assert.strictEqual(render('math-symbols-panel'), null, 'panel closes after insert');
drawPanel();

// ---- recent bar: 12 entries, 6 x 2, clicks replay -----------------------
openPanel();
assert.strictEqual(activeTab(), '变量/常量', 'each open starts on vars');
setLatex(false);
for (const text of ['∞', 'e', 'π', 't', 'n', 'b', 'a', 'z', 'y', 'x']) clickCell(text);
clickTab('运算/结构');
for (const text of ['+', '-', '*']) clickCell(text);
const recentCells = nodeListOf(dialog, 'mss-recent-cell');
assert.strictEqual(recentCells.length, 12, 'recent bar keeps exactly 12 entries');
assert.ok(nodeListOf(dialog, 'mss-recent-cells')[0], 'recent cells use the dedicated 6-column grid');
const recentTitles = recentCells.map((node) => node.props.title);
assert.ok(recentTitles.includes('插入 *'), 'newest entry is first in the recent bar');
assert.ok(!recentTitles.includes('插入 ∞'), 'the 13th insert pushes the oldest entry out');
assert.strictEqual(nodeListOf(dialog, 'mss-recent').length, 1, 'one permanent recent bar');
const dialogChildren = nodeListOf(dialog, 'mss-dialog')[0].children;
const childClasses = dialogChildren.map((node) => (node && node.props ? node.props.className : null));
const recentIndex = childClasses.indexOf('mss-recent');
const tabsIndex = childClasses.indexOf('mss-tabs');
assert.ok(recentIndex >= 0 && tabsIndex > recentIndex, 'recent strip sits above the tab bar');
const bodyNode = nodeListOf(dialog, 'mss-body')[0];
assert.strictEqual(find(bodyNode, (node) => hasClass(node, 'mss-recent')).length, 0,
  'recent bar lives above the tabs, outside the scrolling body');
const firstRecentTitle = recentTitles[0];
setDraft('', 0);
nodeListOf(dialog, 'mss-recent-cell')[0].props.onClick();
drawPanel();
assert.strictEqual(draftValue(), firstRecentTitle.slice('插入 '.length), 'clicking a recent chip replays it');

// ---- shortcut Ctrl+Shift+M opens the panel ------------------------------
press('Escape');
assert.strictEqual(render('math-symbols-panel'), null, 'Escape closes the panel');
drawPanel();
const keydown = domListeners.find((entry) => entry.type === 'keydown');
assert.ok(keydown, 'global keydown listener registered');
keydown.fn({ ctrlKey: true, shiftKey: true, key: 'M', preventDefault() {} });
drawPanel();
assert.ok(dialog !== null, 'Ctrl+Shift+M opens the panel');
press('Escape');
assert.strictEqual(render('math-symbols-panel'), null, 'panel closes again');
drawPanel();

// ---- stale span: retry with a fresh caret --------------------------------
let attempts = 0;
const retrying = {
  captureInsertion: () => ({ draftRev: attempts }),
  insertText: () => { attempts += 1; return attempts >= 2; },
};
render('math-symbols', { inputActions: retrying }).props.onClick();
drawPanel();
setLatex(false);
clickTab('函数');
clickCell('sin');
insertPrimary().props.onClick();
assert.strictEqual(attempts, 2, 'expected one retry with a fresh caret');
drawPanel();

// ---- direct mode: every click writes straight into the composer ----------
openPanel();
assert.ok(modeButton('⌨ 草稿'), 'draft mode is the default');
modeButton('⌨ 草稿').props.onClick();
drawPanel();
assert.strictEqual(storage.get('dsh.mathpad.mode'), 'direct', 'mode must persist');
assert.ok(modeButton('⇢ 直插'), 'mode toggle shows direct mode');
assert.strictEqual(bottomKey('⌫ 删除'), undefined, 'no local backspace in direct mode');
assert.strictEqual(bottomKey('←').props.disabled, true, '← is disabled in direct mode');
assert.strictEqual(bottomKey('→').props.disabled, true, '→ is disabled in direct mode');

const beforeDirect = calls.length;
clickTab('函数');
clickCell('sin');
clickTab('变量/常量');
clickCell('x');
assert.strictEqual(calls.length, beforeDirect + 2, 'direct mode inserts on every click');
assert.deepStrictEqual(calls.slice(beforeDirect).map((call) => call.text), ['sin', 'x']);
assert.ok(dialog !== null, 'panel stays open in direct mode');
clickBottom('数字');
clickNum('3');
assert.strictEqual(calls[calls.length - 1].text, '3', 'the number popover also inserts directly');
assert.strictEqual(textOf(nodeListOf(dialog, 'mss-drafttext')[0]), 'sinx3', 'direct chain shows what was written');
clickBottom('清空');
assert.strictEqual(textOf(nodeListOf(dialog, 'mss-drafttext')[0]), '点符号，直接写进聊天框',
  '清空 clears the direct-mode chain');

insertPrimary().props.onClick();
assert.strictEqual(render('math-symbols-panel'), null, '完成 closes the panel');
drawPanel();
openPanel();
assert.ok(modeButton('⇢ 直插'), 'direct mode persists across opens');
modeButton('⇢ 直插').props.onClick();
drawPanel();
assert.ok(modeButton('⌨ 草稿'), 'switched back to draft mode');
press('Escape');

// ---- inert trigger without inputActions ----------------------------------
const inert = render('math-symbols', {});
assert.strictEqual(inert.props['aria-disabled'], 'true');
assert.strictEqual(inert.props.tabIndex, -1);
inert.props.onClick();

console.log('SMOKE TEST OK - 5 tabs, symbol/template areas, recent 12, bottom bar (caret/clear), number popover, slot fill (lim/int/sum/prod), LaTeX, token delete, direct mode, shortcut, retry');
