/**
 * Smoke test for the client half of dsh-mathpad.
 * Fakes the module loader and React; drives the dock trigger + shell.overlay
 * panel and checks the editable-draft insertion path.
 *
 * Run with the DSH runtime:
 *   $env:ELECTRON_RUN_AS_NODE='1'; & $env:DSH_NODE_EXECUTABLE .\test\smoke.mjs
 */
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert';

const file = new URL('../client.js', import.meta.url);
const code = fs.readFileSync(file, 'utf8');

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
assert.ok(installedStyles[0].textContent.includes('.mss-trigger'), 'trigger styles must be present in the installed sheet');

const render = (id, props) => {
  resetHooks();
  return registrations.get(id).component(props ?? {});
};

function find(node, predicate, out = []) {
  if (node === null || node === undefined) return out;
  if (Array.isArray(node)) { for (const child of node) find(child, predicate, out); return out; }
  if (predicate(node)) out.push(node);
  if (node.children !== undefined) find(node.children, predicate, out);
  return out;
}
const textOf = (node) => {
  if (node === null || node === undefined) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(textOf).join('');
  return textOf(node.children);
};

const byClass = (tree, name) => find(tree, (node) => node.props && node.props.className === name);
const isCell = (node) => node.props && typeof node.props.className === 'string'
  && node.props.className.split(' ').includes('mss-cell') && !node.props.className.includes('mss-toggle');
const cellsOf = () => find(dialog, isCell);
const cell = (tree, glyph) => find(tree, (node) => isCell(node) && node.props.title === '插入 ' + glyph)[0];
// 单击 = 选中 + 输出
const clickCell = (glyph) => {
  const button = cell(dialog, glyph);
  assert.ok(button, 'cell missing: ' + glyph);
  button.props.onClick();
  dialog = render('math-symbols-panel');
};
const clickKey = (label) => {
  const key = find(dialog, (node) => node.props && typeof node.props.className === 'string' && node.props.className.includes('mss-key') && textOf(node) === label)[0];
  assert.ok(key, 'key missing: ' + label);
  key.props.onClick();
  dialog = render('math-symbols-panel');
};
const draftValue = () => byClass(dialog, 'mss-draftinput')[0].props.value;
const preview = () => textOf(byClass(dialog, 'mss-math')[0]);

// ---- before opening: no dialog -------------------------------------------
assert.strictEqual(render('math-symbols-panel'), null, 'panel renders nothing while closed');

const calls = [];
const inputActions = {
  captureInsertion: () => ({ draftRev: 7 }),
  insertText: (text, span) => { calls.push({ text, span }); return true; },
};

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
let dialog = render('math-symbols-panel');
assert.ok(dialog !== null, 'panel must open after the trigger click');

const versionTag = find(dialog, (node) => node.props && node.props.className === 'mss-version')[0];
assert.ok(versionTag, 'panel must show its version so a stale module is obvious');
assert.ok(/^v\d+\.\d+\.\d+$/.test(textOf(versionTag)), 'version tag format, got ' + textOf(versionTag));

const cells = cellsOf();
assert.strictEqual(cells.length, 39, 'expected 39 symbols, got ' + cells.length);
assert.strictEqual(byClass(dialog, 'mss-sect').length, 5, 'expected 5 sections');

// ---- sin3x: chips + digits + editable draft ------------------------------
clickCell('sin');
assert.strictEqual(draftValue(), 'sin');
clickKey('3');
assert.strictEqual(draftValue(), 'sin3');
clickCell('x');
assert.strictEqual(draftValue(), 'sin3x');
assert.strictEqual(preview(), 'sin(3x)', 'sin3x reads as sin(3x), got ' + preview());

// typing directly in the draft also works
byClass(dialog, 'mss-draftinput')[0].props.onChange({ target: { value: 'sin3x+1', selectionStart: 8 } });
dialog = render('math-symbols-panel');
assert.strictEqual(draftValue(), 'sin3x+1');
assert.strictEqual(preview(), 'sin(3x)+1');

// backspace removes one character
find(dialog, (node) => node.props && typeof node.props.className === 'string' && node.props.className.includes('mss-key-clear'))[0].props.onClick();
dialog = render('math-symbols-panel');
assert.strictEqual(draftValue(), 'sin3x+');

// ---- insert sends the draft and reuses the captured caret ----------------
byClass(dialog, 'mss-draftinput')[0].props.onChange({ target: { value: 'sin3x', selectionStart: 5 } });
dialog = render('math-symbols-panel');
byClass(dialog, 'mss-btn mss-btn-primary')[0].props.onClick();
assert.strictEqual(calls.length, 1);
assert.strictEqual(calls[0].text, 'sin3x');
assert.strictEqual(calls[0].span.draftRev, 7);
assert.strictEqual(render('math-symbols-panel'), null, 'panel closes after insert');

// ---- unicode superscript: sin²x, e³, x⁵ --------------------------------
trigger.props.onClick();
dialog = render('math-symbols-panel');
clickCell('sin');
clickKey('ⁿ');
clickKey('²');
clickCell('x');
assert.strictEqual(draftValue(), 'sin²x');
assert.strictEqual(preview(), '(sin x)²', 'sin²x reads as (sin x)², got ' + preview());

clickKey('分式');
assert.ok(draftValue().includes('( )/( )'), 'fraction template inserted, got ' + draftValue());

byClass(dialog, 'mss-draftinput')[0].props.onChange({ target: { value: 'e3', selectionStart: 2 } });
dialog = render('math-symbols-panel');
assert.strictEqual(preview(), 'e³');

byClass(dialog, 'mss-draftinput')[0].props.onChange({ target: { value: 'x5', selectionStart: 2 } });
dialog = render('math-symbols-panel');
assert.strictEqual(preview(), 'x⁵');

// ---- operators: contour integral and partial derivative -------------------
const glyphs = cellsOf().map((node) => node.props.title);
assert.ok(glyphs.includes('插入 ∮'), 'contour integral cell missing');
assert.ok(glyphs.includes('插入 ∂'), 'partial derivative cell missing');
assert.ok(!find(dialog, (node) => node.props && node.props.className === 'mss-search').length, 'search box should be gone');

// ---- variables group + a–z letter strip -----------------------------------
const titles = cellsOf().map((node) => node.props.title);
assert.ok(titles.includes('插入 x'), 'variable x missing');
assert.ok(titles.includes('插入 θ'), 'variable θ missing');

find(dialog, (node) => node.props && typeof node.props.className === 'string' && node.props.className.includes('mss-toggle'))[0].props.onClick();
dialog = render('math-symbols-panel');
assert.strictEqual(cellsOf().length, 65, 'letters strip adds 26 cells');
byClass(dialog, 'mss-draftinput')[0].props.onChange({ target: { value: '', selectionStart: 0 } });
dialog = render('math-symbols-panel');
find(dialog, (node) => node.props && node.props.title === '插入 a' && typeof node.props.className === 'string' && node.props.className.includes('mss-letter-cell'))[0].props.onClick();
dialog = render('math-symbols-panel');
assert.strictEqual(draftValue(), 'a', 'letter a inserted');

find(dialog, (node) => node.props && typeof node.props.className === 'string' && node.props.className.includes('mss-toggle'))[0].props.onClick();
dialog = render('math-symbols-panel');
assert.strictEqual(cellsOf().length, 39, 'letters strip collapses again');

// ---- hover selects (single visual state), arrows move, Enter outputs -----
find(dialog, (node) => node.props && node.props.className === 'mss-sect')[0].props.onMouseEnter();
dialog = render('math-symbols-panel');
assert.ok(find(dialog, (node) => node.props && typeof node.props.className === 'string'
  && node.props.className.includes('mss-cell-focus')).length > 0, 'hover shows the selection ring');

byClass(dialog, 'mss-scrim')[0].props.onKeyDown({ key: 'ArrowRight', preventDefault() {} });
dialog = render('math-symbols-panel');
const focused = find(dialog, (node) => node.props && typeof node.props.className === 'string'
  && node.props.className.includes('mss-cell-focus'))[0];
assert.ok(focused, 'focused cell missing after ArrowRight');
assert.strictEqual(focused.props.title, '插入 y', 'ArrowRight moves focus to y, got ' + focused.props.title);

// Enter inside the draft input must not swallow the selection
byClass(dialog, 'mss-draftinput')[0].props.onKeyDown({ key: 'Enter', preventDefault() {}, stopPropagation() {} });
dialog = render('math-symbols-panel');
assert.ok(draftValue().endsWith('y'), 'Enter from the draft input outputs the selected cell, got ' + draftValue());

for (let step = 0; step < 10; step += 1) {
  byClass(dialog, 'mss-scrim')[0].props.onKeyDown({ key: 'ArrowRight', preventDefault() {} });
  dialog = render('math-symbols-panel');
}
const crossed = find(dialog, (node) => node.props && typeof node.props.className === 'string'
  && node.props.className.includes('mss-cell-focus'))[0];
assert.strictEqual(crossed.props.title, '插入 sin', 'arrow keys cross into the next section, got ' + crossed.props.title);

find(dialog, (node) => node.props && node.props.className === 'mss-body')[0].props.onMouseLeave();
dialog = render('math-symbols-panel');
assert.strictEqual(find(dialog, (node) => node.props && typeof node.props.className === 'string'
  && node.props.className.includes('mss-cell-focus')).length, 0, 'silent when the pointer leaves the grid');

// ---- single click selects and outputs ------------------------------------
byClass(dialog, 'mss-draftinput')[0].props.onChange({ target: { value: '', selectionStart: 0 } });
dialog = render('math-symbols-panel');
cell(dialog, 'sin').props.onClick();
dialog = render('math-symbols-panel');
assert.strictEqual(draftValue(), 'sin', 'single click inserts');
assert.ok(find(dialog, (node) => node.props && typeof node.props.className === 'string'
  && node.props.className.includes('mss-cell-focus')).length > 0, 'single click also selects');

// ---- hover follows the cell under the pointer ----------------------------
byClass(dialog, 'mss-draftinput')[0].props.onChange({ target: { value: '', selectionStart: 0 } });
dialog = render('math-symbols-panel');
cell(dialog, 'tan').props.onMouseEnter();
dialog = render('math-symbols-panel');
const hovered = find(dialog, (node) => node.props && typeof node.props.className === 'string'
  && node.props.className.includes('mss-cell-focus'))[0];
assert.ok(hovered, 'hovering a cell selects it');
assert.strictEqual(hovered.props.title, '插入 tan', 'hover selects the cell under the pointer, got ' + hovered.props.title);
cell(dialog, 'tan').props.onClick();
dialog = render('math-symbols-panel');
assert.strictEqual(draftValue(), 'tan', 'clicking the hovered cell outputs it');

// ---- keypad is reachable with Tab and Enter runs the focused key ----------
byClass(dialog, 'mss-draftinput')[0].props.onChange({ target: { value: '', selectionStart: 0 } });
dialog = render('math-symbols-panel');
for (let step = 0; step < 4; step += 1) {
  byClass(dialog, 'mss-scrim')[0].props.onKeyDown({ key: 'Tab', preventDefault() {} });
  dialog = render('math-symbols-panel');
}
const focusedKey = find(dialog, (node) => node.props && typeof node.props.className === 'string'
  && node.props.className.includes('mss-key-focus'))[0];
assert.ok(focusedKey, 'keypad keys can be focused with Tab');
byClass(dialog, 'mss-scrim')[0].props.onKeyDown({ key: 'Enter', preventDefault() {} });
dialog = render('math-symbols-panel');
assert.strictEqual(draftValue(), '1', 'Enter runs the focused keypad key, got ' + draftValue());

// ---- Enter never closes the panel ---------------------------------------
byClass(dialog, 'mss-draftinput')[0].props.onChange({ target: { value: '', selectionStart: 0 } });
dialog = render('math-symbols-panel');
find(dialog, (node) => node.props && node.props.className === 'mss-body')[0].props.onMouseLeave();
dialog = render('math-symbols-panel');
byClass(dialog, 'mss-scrim')[0].props.onKeyDown({ key: 'Enter', preventDefault() {} });
dialog = render('math-symbols-panel');
assert.ok(dialog !== null, 'Enter with an empty draft keeps the panel open');

// ---- multi-character symbols delete as one token -------------------------
byClass(dialog, 'mss-draftinput')[0].props.onChange({ target: { value: 'sinx', selectionStart: 3 } });
dialog = render('math-symbols-panel');
clickKey('⌫ 删除');
assert.strictEqual(draftValue(), 'x', 'backspace removes the whole sin token, got ' + draftValue());

byClass(dialog, 'mss-draftinput')[0].props.onChange({ target: { value: 'lim', selectionStart: 3 } });
dialog = render('math-symbols-panel');
clickKey('⌫ 删除');
assert.strictEqual(draftValue(), '', 'backspace removes the whole lim token, got ' + draftValue());

byClass(dialog, 'mss-draftinput')[0].props.onChange({ target: { value: 'asin', selectionStart: 4 } });
dialog = render('math-symbols-panel');
clickKey('⌫ 删除');
assert.strictEqual(draftValue(), 'a', 'asin is tokenized as a + sin, so sin is removed whole, got ' + draftValue());

byClass(dialog, 'mss-draftinput')[0].props.onChange({ target: { value: 'limcosx', selectionStart: 7 } });
dialog = render('math-symbols-panel');
clickKey('⌫ 删除');
assert.strictEqual(draftValue(), 'limcos', 'composite: x removed, got ' + draftValue());
byClass(dialog, 'mss-draftinput')[0].props.onChange({ target: { value: 'limcos', selectionStart: 6 } });
dialog = render('math-symbols-panel');
clickKey('⌫ 删除');
assert.strictEqual(draftValue(), 'lim', 'composite: cos removed as one token, got ' + draftValue());

byClass(dialog, 'mss-draftinput')[0].props.onChange({ target: { value: 'arcsinsin', selectionStart: 9 } });
dialog = render('math-symbols-panel');
clickKey('⌫ 删除');
assert.strictEqual(draftValue(), 'arcsin', 'composite: trailing sin removed as one token, got ' + draftValue());

byClass(dialog, 'mss-draftinput')[0].props.onChange({ target: { value: 'ln', selectionStart: 2 } });
dialog = render('math-symbols-panel');
const draftInput = byClass(dialog, 'mss-draftinput')[0];
let prevented = false;
draftInput.props.onKeyDown({
  key: 'Backspace',
  currentTarget: { selectionStart: 2, selectionEnd: 2 },
  preventDefault: () => { prevented = true; },
});
dialog = render('math-symbols-panel');
assert.ok(prevented, 'token backspace prevents the native single-char delete');
assert.strictEqual(draftValue(), '', 'input backspace removes the whole ln token, got ' + draftValue());

// ---- Escape closes -------------------------------------------------------
byClass(dialog, 'mss-scrim')[0].props.onKeyDown({ key: 'Escape', stopPropagation() {} });
assert.strictEqual(render('math-symbols-panel'), null);

// ---- inert trigger without inputActions ----------------------------------
const inert = render('math-symbols', {});
assert.strictEqual(inert.props['aria-disabled'], 'true');
assert.strictEqual(inert.props.tabIndex, -1);
inert.props.onClick();

// ---- stale span: retry with a fresh caret --------------------------------
let attempts = 0;
const retrying = {
  captureInsertion: () => ({ draftRev: attempts }),
  insertText: () => { attempts += 1; return attempts >= 2; },
};
render('math-symbols', { inputActions: retrying }).props.onClick();
dialog = render('math-symbols-panel');
clickCell('sin');
byClass(dialog, 'mss-btn mss-btn-primary')[0].props.onClick();
assert.strictEqual(attempts, 2, 'expected one retry with a fresh caret');

// ---- direct mode: every click writes straight into the composer ----------
trigger.props.onClick();
dialog = render('math-symbols-panel');
const modeButton = find(dialog, (node) => node.props && node.props.className === 'mss-mode')[0];
assert.ok(modeButton, 'mode toggle missing');
modeButton.props.onClick();
dialog = render('math-symbols-panel');
assert.strictEqual(storage.get('dsh.mathpad.mode'), 'direct', 'mode must persist');

const before = calls.length;
clickCell('sin');
clickKey('3');
clickCell('x');
assert.strictEqual(calls.length, before + 3, 'direct mode inserts on every click');
assert.deepStrictEqual(calls.slice(before).map((call) => call.text), ['sin', '3', 'x']);
assert.ok(dialog !== null, 'panel stays open in direct mode');
assert.strictEqual(preview(), 'sin(3x)', 'direct chain preview, got ' + preview());

byClass(dialog, 'mss-btn mss-btn-primary')[0].props.onClick();
assert.strictEqual(render('math-symbols-panel'), null, 'done closes the panel');

trigger.props.onClick();
dialog = render('math-symbols-panel');
assert.ok(
  find(dialog, (node) => node.props && node.props.className === 'mss-mode' && node.children === '⇢ 直插').length > 0,
  'direct mode persists across opens',
);

// ---- LaTeX mode: convert the draft before inserting ----------------------
// back to draft mode first (direct mode is on from the previous block)
find(dialog, (node) => node.props && node.props.className === 'mss-mode' && node.children === '⇢ 直插')[0].props.onClick();
dialog = render('math-symbols-panel');

const texButton = find(dialog, (node) => node.props && node.props.className === 'mss-mode' && node.children === 'TeX')[0];
assert.ok(texButton, 'TeX toggle missing');
texButton.props.onClick();
dialog = render('math-symbols-panel');
assert.strictEqual(storage.get('dsh.mathpad.latex'), 'on', 'latex mode must persist');
assert.ok(
  find(dialog, (node) => node.props && node.props.className === 'mss-lbl' && node.children === 'LaTeX').length > 0,
  'preview label must switch to LaTeX',
);

byClass(dialog, 'mss-draftinput')[0].props.onChange({ target: { value: 'limx→0 sinx', selectionStart: 12 } });
dialog = render('math-symbols-panel');
assert.strictEqual(preview(), '\\lim_{x \\to 0} \\sin x', 'latex conversion, got ' + preview());
assert.ok(glyphs.includes('插入 ∮'), 'sanity');

byClass(dialog, 'mss-draftinput')[0].props.onChange({ target: { value: 'x²', selectionStart: 2 } });
dialog = render('math-symbols-panel');
assert.strictEqual(preview(), 'x^{2}', 'superscript latex, got ' + preview());

byClass(dialog, 'mss-draftinput')[0].props.onChange({ target: { value: '(sinx)/(1+sinx)', selectionStart: 16 } });
dialog = render('math-symbols-panel');
assert.strictEqual(preview(), '\\frac{\\sin x}{1+\\sin x}', 'fraction latex, got ' + preview());

const beforeTex = calls.length;
byClass(dialog, 'mss-btn mss-btn-primary')[0].props.onClick();
assert.strictEqual(calls.length, beforeTex + 1);
assert.strictEqual(calls[calls.length - 1].text, '\\frac{\\sin x}{1+\\sin x}');

console.log('SMOKE TEST OK - trigger, sections, variables, letters, superscript, fraction, latex, keyboard nav, escape, retry, direct mode');
