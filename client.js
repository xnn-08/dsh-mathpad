window.__ModuleLoader__.load({
  id: 'dsh-mathpad',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    // 与 package.json 的 version 保持一致：面板底部会显示它，用来确认页面里跑的是哪一版。
    const VERSION = '0.6.1';

    // ---------------------------------------------------------------------
    // 符号表：面板渲染、页签、LaTeX 转换都从这张表生成。加一个符号 = 加一行。
    // 5 个页签按数学角色划分：变量/常量、运算/结构、函数、希腊字母、微积分。
    // 平铺符号：[glyph, text, latex]
    // 模板项：  [glyph, text, latex, offset, meta?, 'tpl']
    //   offset = 插入后光标落点；meta = 打开填空页（lim / int / sum / prod）。
    // 同一个符号全局只出现一次（「最近」条除外）。
    // ---------------------------------------------------------------------
    const GROUPS = [
      {
        id: 'vars',
        name: '变量/常量',
        items: [
          ['x', 'x', 'x'],
          ['y', 'y', 'y'],
          ['z', 'z', 'z'],
          ['a', 'a', 'a'],
          ['b', 'b', 'b'],
          ['n', 'n', 'n'],
          ['t', 't', 't'],
          ['π', 'π', '\\pi'],
          ['e', 'e', 'e'],
          ['∞', '∞', '\\infty'],
        ],
        templates: [],
      },
      {
        id: 'ops',
        name: '运算/结构',
        items: [
          ['+', '+', '+'],
          ['−', '-', '-'],
          ['×', '*', '\\times'],
          // ÷ 以前插入 ASCII '/'，和新增的 '/' 符号撞车；现在各插各的，TeX 仍是 \div / '/'
          ['÷', '÷', '\\div'],
          ['=', '=', '='],
          ['(', '(', '('],
          [')', ')', ')'],
          ['[', '[', '['],
          [']', ']', ']'],
          ['±', '±', '\\pm'],
          ['≠', '≠', '\\neq'],
          ['≤', '≤', '\\leq'],
          ['≥', '≥', '\\geq'],
        ],
        templates: [
          ['x²', 'x²', 'x^{2}', 2, undefined, 'tpl'],
          ['x³', 'x³', 'x^{3}', 2, undefined, 'tpl'],
          ['√', '√', '\\sqrt', 1, undefined, 'tpl'],
          ['ⁿ√', '√[]()', '\\sqrt[n]{}', 2, undefined, 'tpl'],
          ['分式', '( )/( )', '\\frac{}{}', 2, undefined, 'tpl'],
        ],
      },
      {
        id: 'fn',
        name: '函数',
        items: [
          ['sin', 'sin', '\\sin'],
          ['cos', 'cos', '\\cos'],
          ['tan', 'tan', '\\tan'],
          ['cot', 'cot', '\\cot'],
          ['sec', 'sec', '\\sec'],
          ['csc', 'csc', '\\csc'],
          ['arcsin', 'arcsin', '\\arcsin'],
          ['arccos', 'arccos', '\\arccos'],
          ['arctan', 'arctan', '\\arctan'],
          ['ln', 'ln', '\\ln'],
          ['log', 'log', '\\log'],
        ],
        templates: [],
      },
      {
        id: 'greek',
        name: '希腊字母',
        items: [
          ['α', 'α', '\\alpha'],
          ['β', 'β', '\\beta'],
          ['γ', 'γ', '\\gamma'],
          ['δ', 'δ', '\\delta'],
          ['ε', 'ε', '\\epsilon'],
          ['ζ', 'ζ', '\\zeta'],
          ['η', 'η', '\\eta'],
          ['θ', 'θ', '\\theta'],
          ['ι', 'ι', '\\iota'],
          ['κ', 'κ', '\\kappa'],
          ['λ', 'λ', '\\lambda'],
          ['μ', 'μ', '\\mu'],
          ['ν', 'ν', '\\nu'],
          ['ξ', 'ξ', '\\xi'],
          ['ρ', 'ρ', '\\rho'],
          ['σ', 'σ', '\\sigma'],
          ['τ', 'τ', '\\tau'],
          ['υ', 'υ', '\\upsilon'],
          ['φ', 'φ', '\\phi'],
          ['ψ', 'ψ', '\\psi'],
          ['ω', 'ω', '\\omega'],
          ['Γ', 'Γ', '\\Gamma'],
          ['Δ', 'Δ', '\\Delta'],
          ['Θ', 'Θ', '\\Theta'],
          ['Λ', 'Λ', '\\Lambda'],
          ['Ξ', 'Ξ', '\\Xi'],
          ['Π', 'Π', '\\Pi'],
          ['Σ', 'Σ', '\\Sigma'],
          ['Φ', 'Φ', '\\Phi'],
          ['Ψ', 'Ψ', '\\Psi'],
          ['Ω', 'Ω', '\\Omega'],
        ],
        templates: [],
      },
      {
        id: 'calc',
        name: '微积分',
        items: [
          ['∫', '∫', '\\int'],
          ['∮', '∮', '\\oint'],
          ['∂', '∂', '\\partial'],
          ['d', 'd', 'd'],
          ['∇', '∇', '\\nabla'],
          ['→', '→', '\\to'],
        ],
        templates: [
          ['∫ₐᵇ', '∫_()^()', '\\int_{}^{}', 3, 'int', 'tpl'],
          ['lim→', 'lim()→()', '\\lim_{} \\to ', 4, 'lim', 'tpl'],
          ['Σₙ', '∑_()^()', '\\sum_{}^{}', 3, 'sum', 'tpl'],
          ['∏ₙ', '∏_()^()', '\\prod_{}^{}', 3, 'prod', 'tpl'],
        ],
      },
    ];

    // 页签顺序 / 查找：面板和方向键导航都按这张表的顺序走。
    const TAB_IDS = GROUPS.map((group) => group.id);
    const groupOf = (id) => GROUPS.find((group) => group.id === id) ?? GROUPS[0];
    // 填空页的变量格子固定用「变量/常量」页签，和用户当前在哪个页签无关。
    const SLOT_VARS = groupOf('vars').items;

    // 填空页（两个空 + 变量/数字键盘）的文案和提交格式。
    const SLOT_SPECS = {
      lim: {
        title: 'lim 模板', symbol: 'lim', labels: ['极限点', '趋向'], join: '→', placeholders: ['x', '0'],
        build: (from, to) => 'lim(' + from + ')→(' + to + ')',
      },
      int: {
        title: '积分上下限', symbol: '∫', labels: ['下限', '上限'], join: '^', placeholders: ['0', '1'],
        build: (from, to) => '∫_(' + from + ')^(' + to + ')',
      },
      sum: {
        title: '求和上下限', symbol: '∑', labels: ['下限', '上限'], join: '^', placeholders: ['a', 'b'],
        build: (from, to) => '∑_(' + from + ')^(' + to + ')',
      },
      prod: {
        title: '连乘上下限', symbol: '∏', labels: ['下限', '上限'], join: '^', placeholders: ['a', 'b'],
        build: (from, to) => '∏_(' + from + ')^(' + to + ')',
      },
    };

    // 底部「数字」弹窗：3 列 × 4 行，1-9、0、.、/。
    const NUM_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '.', '/'];

    // 字母条：常用变量之外的 a–z，按需展开，不占常驻空间。
    const LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('').map((letter) => [letter, letter, letter]);
    const LETTER_CELLS = LETTERS.map((item) => ({ glyph: item[0], text: item[1] }));

    // 最近使用：只记完整插入文本，展示时再截断。
    const RECENT_KEY = 'dsh.mathpad.recent';
    const RECENT_LIMIT = 12;
    let recentItems = [];
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(RECENT_KEY) : null;
      if (raw !== null) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) recentItems = parsed.filter((item) => item && typeof item.text === 'string').slice(0, RECENT_LIMIT);
      }
    } catch { recentItems = []; }
    const saveRecent = () => {
      try {
        if (typeof localStorage !== 'undefined') localStorage.setItem(RECENT_KEY, JSON.stringify(recentItems));
      } catch { /* 记住失败不影响使用 */ }
    };
    const rememberRecent = (value) => {
      if (typeof value !== 'string' || value.trim() === '' || /^[0-9 ]$/.test(value)) return;
      const label = value.length > 8 ? value.slice(0, 8) + '…' : value;
      recentItems = [{ text: value, label }, ...recentItems.filter((item) => item.text !== value)].slice(0, RECENT_LIMIT);
      saveRecent();
    };

    // 函数名用于 LaTeX 的“补空格 + 收下标”规则；长的排前面，避免 arcsin 被 sin 抢先匹配。
    const FUNCS = GROUPS.find((group) => group.id === 'fn').items
      .map((item) => item[1])
      .sort((a, b) => b.length - a.length);

    // 函数名已经由上面的正则处理，这里只收非函数符号，避免 \sin 被二次转义成 \\sin
    // 多字符符号按“一个整体”处理：退格一次删掉 sin / lim，而不是一个字母。
    const TOKEN_NAMES = Array.from(new Set([...FUNCS, 'lim'])).sort((a, b) => b.length - a.length);

    // 切成符号序列，长名优先：arcsinsinx → [arcsin, sin, x]，limcosx → [lim, cos, x]。
    const tokenize = (source) => {
      const tokens = [];
      let index = 0;
      while (index < source.length) {
        const rest = source.slice(index);
        const filledLim = /^lim\([^()]*\)→\([^()]*\)/.exec(rest);
        if (filledLim !== null) {
          tokens.push({ value: 'lim', start: index });
          tokens.push({ value: filledLim[0].slice(3), start: index + 3 });
          index += filledLim[0].length;
          continue;
        }
        // 填好的 ∫/∑/∏ 模板：符号本身 + 上下限算一个整体（退格一次删掉上下限）。
        const filledBig = /^(?:∫|∑|∏)_\([^()]*\)\^\([^()]*\)/.exec(rest);
        if (filledBig !== null) {
          tokens.push({ value: filledBig[0][0], start: index });
          tokens.push({ value: filledBig[0].slice(1), start: index + 1 });
          index += filledBig[0].length;
          continue;
        }
        let matched = null;
        for (const token of TOKEN_NAMES) {
          if (source.startsWith(token, index)) { matched = token; break; }
        }
        if (matched !== null) {
          tokens.push({ value: matched, start: index });
          index += matched.length;
        } else {
          tokens.push({ value: source[index], start: index });
          index += 1;
        }
      }
      return tokens;
    };

    const tokenStartBefore = (source, position) => {
      if (position <= 0) return null;
      const tokens = tokenize(source.slice(0, position));
      const last = tokens[tokens.length - 1];
      if (last === undefined || last.value.length <= 1) return null;
      return last.start;
    };

    // 函数名正则只编译一次（toLatex 每次渲染都会调用）。
    const FN_LATEX_RE = new RegExp('(?<!\\\\)(' + TOKEN_NAMES.join('|') + ')', 'g');

    const LATEX_SYMBOLS = [];
    // 符号和模板一起驱动：加了模板不用再单独维护一张 LaTeX 表。
    for (const group of GROUPS) {
      for (const item of [...group.items, ...group.templates]) {
        // 函数名（含 lim）由正则单独处理，不能再进符号替换表，否则 \lim 会被二次转义成 \\lim
        if (TOKEN_NAMES.includes(item[1])) continue;
        // '/' 在 TeX 里本来就是字符本身（分式由 (a)/(b) → \frac 处理），不产生映射。
        if (item[2] !== item[1] && item[2] !== '') LATEX_SYMBOLS.push([item[1], item[2]]);
      }
    }
    // 0.5.x 面板里的常驻 ∑ ∏ ∐ 现在不再是符号：∑ ∏ 由模板产生，∐ 不再展示。
    // 草稿里仍可能留下它们（例如删掉上下限后只剩 ∑），旧映射保留，TeX 输出不变。
    for (const legacy of [['∑', '\\sum'], ['∏', '\\prod'], ['∐', '\\coprod']]) LATEX_SYMBOLS.push(legacy);
    LATEX_SYMBOLS.sort((a, b) => b[0].length - a[0].length);

    // Unicode 上标：幂次直接插字符，不再用“空格 = 次方”。
    const SUPERSCRIPT_DIGITS = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹'];
    const SUPERSCRIPT_LATEX = {
      '⁰': '^{0}', '¹': '^{1}', '²': '^{2}', '³': '^{3}', '⁴': '^{4}',
      '⁵': '^{5}', '⁶': '^{6}', '⁷': '^{7}', '⁸': '^{8}', '⁹': '^{9}', 'ⁿ': '^{n}',
    };

    /**
     * 把草稿翻译成人话，用来给用户确认：
     *   sin²x → (sin x)²     （上标紧跟函数名 = 函数的幂）
     *   sin3x → sin(3x)      （没有空格 = 倍数，保留旧写法）
     *   e3 → e³ ／ x5 → x⁵   （e、x 后面的数字 = 指数）
     * 只做展示，插入的始终是草稿原文。
     */
    const explain = (raw) => {
      let out = raw;
      for (const fn of FUNCS) {
        const escaped = fn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        out = out.replace(new RegExp(escaped + '([⁰¹²³⁴⁵⁶⁷⁸⁹ⁿ]+)([a-zA-Z])', 'g'),
          (match, power, arg) => '(' + fn + ' ' + arg + ')' + power);
        out = out.replace(new RegExp(escaped + '([0-9]+)([a-zA-Z(])', 'g'), (match, multiple, arg) => fn + '(' + multiple + arg + ')');
        out = out.replace(new RegExp(escaped + '([a-zA-Z])', 'g'), (match, arg) => fn + '(' + arg + ')');
      }
      out = out.replace(/(^|[^a-zA-Z])e([0-9]+)/g, (match, prefix, power) => prefix + 'e' + (SUPERSCRIPT_DIGITS[Number(power)] ?? power));
      out = out.replace(/ex(?![a-zA-Z])/g, 'eˣ');
      out = out.replace(/(^|[^a-zA-Z])x([0-9]+)/g, (match, prefix, power) => prefix + 'x' + (SUPERSCRIPT_DIGITS[Number(power)] ?? power));
      return out;
    };

    // ---------------------------------------------------------------------
    // 面板状态：dock 里的触发按钮和 shell.overlay 里的弹窗共享这一份。
    // text 是可编辑的草稿；span 是打开面板那一刻输入框里的光标位置。
    // ---------------------------------------------------------------------
    const panel = {
      open: false,
      actions: null,
      span: null,
      text: '',
      direct: false,
      latex: false,
      letters: false,
      sup: false,
      num: false,
      tab: 'vars',
      mode: 'idle',
      focusIndex: 0,
      pointerInDraft: false,
      flash: '',
      slot: null,
      slotStart: 0,
      slotEnd: 0,
      chain: [],
    };
    // 草稿里最后的光标位置：点击符号时插在这里，而不是总插到末尾。
    let caretPosition = null;
    const listeners = new Set();
    const emit = () => { for (const listener of listeners) listener(); };
    const patchPanel = (patch) => { Object.assign(panel, patch); emit(); };
    let flashTimer = null;
    const flash = (message) => {
      if (flashTimer !== null) clearTimeout(flashTimer);
      patchPanel({ flash: message });
      flashTimer = setTimeout(() => { patchPanel({ flash: '' }); }, 1400);
    };

    const stateHook = () => {
      const [, force] = React.useState(0);
      React.useEffect(() => {
        const listener = () => force((value) => value + 1);
        listeners.add(listener);
        return () => { listeners.delete(listener); };
      }, []);
      return panel;
    };

    const MODE_KEY = 'dsh.mathpad.mode';
    const LATEX_KEY = 'dsh.mathpad.latex';
    const readDirectMode = () => {
      try {
        return typeof localStorage !== 'undefined' && localStorage.getItem(MODE_KEY) === 'direct';
      } catch {
        return false;
      }
    };
    const writeDirectMode = (direct) => {
      try {
        if (typeof localStorage !== 'undefined') localStorage.setItem(MODE_KEY, direct ? 'direct' : 'draft');
      } catch {
        /* 记住模式失败不影响使用 */
      }
    };
    const readLatexMode = () => {
      try {
        return typeof localStorage !== 'undefined' && localStorage.getItem(LATEX_KEY) === 'on';
      } catch {
        return false;
      }
    };
    const writeLatexMode = (latex) => {
      try {
        if (typeof localStorage !== 'undefined') localStorage.setItem(LATEX_KEY, latex ? 'on' : 'off');
      } catch {
        /* 同上 */
      }
    };

    /**
     * 把草稿翻译成 LaTeX。只处理我们面板里出现过的写法和几个常见组合，
     * 目标是“点出来的式子能直接当 LaTeX 用”，不是完整的 TeX 解析器。
     */
    const toLatex = (raw) => {
      let out = raw;
      // 模板填好后的写法
      out = out.replace(/lim\(([^()]*)\)→\(([^()]*)\)/g,
        (match, from, to) => '\\lim_{' + from.trim() + ' \\to ' + to.trim() + '}');
      out = out.replace(/∫_\(([^()]*)\)\^\(([^()]*)\)/g,
        (match, low, high) => '\\int_{' + low + '}^{' + high + '}');
      out = out.replace(/∑_\(([^()]*)\)\^\(([^()]*)\)/g,
        (match, low, high) => '\\sum_{' + low + '}^{' + high + '}');
      out = out.replace(/∏_\(([^()]*)\)\^\(([^()]*)\)/g,
        (match, low, high) => '\\prod_{' + low + '}^{' + high + '}');
      out = out.replace(/√\[([^\]]*)\]\(([^()]*)\)/g,
        (match, index, body) => '\\sqrt[' + index + ']{' + body + '}');
      // 分式模板 (分子)/(分母) → \frac{分子}{分母}
      out = out.replace(/\(([^()]*)\)\/\(([^()]*)\)/g, (match, numerator, denominator) => '\\frac{' + numerator + '}{' + denominator + '}');
      // 函数名：长名优先；后面紧跟字母/数字时补一个空格（\sin x 而不是 \sinx）
      FN_LATEX_RE.lastIndex = 0;
      out = out.replace(FN_LATEX_RE, (match, _name, offset, whole) => {
        const next = whole[offset + match.length] ?? '';
        return '\\' + match + (/[a-zA-Z0-9]/.test(next) ? ' ' : '');
      });
      // Unicode 上标 → 幂
      for (const [from, to] of Object.entries(SUPERSCRIPT_LATEX)) out = out.split(from).join(to);
      // 符号表里的映射：长的先替换，避免 x2 被 x 抢先
      for (const [from, to] of LATEX_SYMBOLS) out = out.split(from).join(to);
      // lim 后面跟着含“→”的一段时才收进下标，避免把普通参数误当下标
      out = out.replace(/\\lim\s*([^\s$]*\\to[^\s$]*)/g, (match, sub) => '\\lim_{' + sub.replace(/\\to/g, ' \\to ') + '}');
      // √ 后面紧跟的一段收进花括号
      out = out.replace(/\\sqrt(?!\[)([^\s$]+)/g, (match, body) => '\\sqrt{' + body + '}');
      return out;
    };

    const openPanel = (actions) => {
      if (actions === undefined || actions === null) return;
      let span = null;
      try { span = actions.captureInsertion(); } catch { span = null; }
      patchPanel({ open: true, actions, span, text: '', direct: readDirectMode(), latex: readLatexMode(), letters: false, sup: false, num: false, tab: 'vars', mode: 'idle', focusIndex: 0, pointerInDraft: false, flash: '', slot: null, slotStart: 0, slotEnd: 0, chain: [] });
      caretPosition = null;
    };
    const closePanel = () => {
      patchPanel({ open: false, actions: null, span: null, text: '', chain: [], slot: null });
    };

    const setDirectMode = (direct) => {
      writeDirectMode(direct);
      patchPanel({ direct, chain: direct ? panel.chain : [] });
    };

    const setLatexMode = (latex) => {
      writeLatexMode(latex);
      patchPanel({ latex });
    };

    // 直插：每次点符号都用最新光标写进聊天框，面板不关，可以连续点。
    const insertDirect = (snippet) => {
      const actions = panel.actions;
      if (actions === null) return false;
      const payload = panel.latex ? toLatex(snippet) : snippet;
      let inserted = false;
      for (let attempt = 0; attempt < 3 && !inserted; attempt += 1) {
        let span = null;
        try { span = actions.captureInsertion(); } catch { span = null; }
        if (span === null) break;
        inserted = actions.insertText(payload, span) === true;
      }
      if (inserted) patchPanel({ chain: [...panel.chain, payload] });
      return inserted;
    };

    const insertDraft = () => {
      const raw = panel.text.trim();
      const text = panel.latex ? toLatex(raw) : raw;
      const actions = panel.actions;
      if (text === '') return;
      let inserted = false;
      if (actions !== null) {
        let span = panel.span;
        for (let attempt = 0; attempt < 3 && !inserted; attempt += 1) {
          if (span === null) {
            try { span = actions.captureInsertion(); } catch { span = null; }
          }
          if (span === null) break;
          inserted = actions.insertText(text, span) === true;
          span = null; // 版本对不上就重新捕获光标再试
        }
      }
      if (!inserted && typeof navigator !== 'undefined' && navigator.clipboard !== undefined) {
        navigator.clipboard.writeText(text).catch(() => {});
      }
      closePanel();
    };

    // 点按钮不抢走输入框焦点（保持外部光标位置）。
    const keepFocus = (event) => { event.preventDefault(); };

    /**
     * 让 ∑ 的墨迹在自己的盒子里垂直居中（上下留白相等）。
     * 盒子由宿主那一行居中，于是它自然和右侧控件同轴。
     * 只用 canvas 的字体/墨迹度量，不做“和邻居比”的包围盒对齐。
     * 字号放大 10 倍再除回去，避开 Chrome 整数像素的量化误差。
     */
    const centerGlyphInk = (node) => {
      if (node === null || node === undefined) return;
      if (typeof window === 'undefined' || typeof document === 'undefined') return;
      try {
        const style = window.getComputedStyle(node);
        const canvas = document.createElement('canvas');
        if (typeof canvas.getContext !== 'function') return;
        const ctx = canvas.getContext('2d');
        if (ctx === null) return;
        const scale = 10;
        const size = Number.parseFloat(style.fontSize);
        if (!Number.isFinite(size) || size <= 0) return;
        ctx.font = `${style.fontStyle} ${style.fontWeight} ${size * scale}px ${style.fontFamily}`;
        const metrics = ctx.measureText('∑');
        const inkAscent = metrics.actualBoundingBoxAscent;
        const inkDescent = metrics.actualBoundingBoxDescent;
        const fontAscent = metrics.fontBoundingBoxAscent;
        const fontDescent = metrics.fontBoundingBoxDescent;
        if (![inkAscent, inkDescent, fontAscent, fontDescent].every((n) => typeof n === 'number' && Number.isFinite(n))) return;
        // 行内盒把字体 em 盒居中，所以“em 盒中心 - 墨迹中心”就是把墨迹移到盒中心的位移。
        const shift = ((fontDescent - fontAscent) - (inkDescent - inkAscent)) / 2 / scale;
        if (!Number.isFinite(shift)) return;
        node.style.setProperty('--mss-ink-center', `${shift.toFixed(2)}px`);
      } catch {
        /* 测量失败就用 CSS 兜底 */
      }
    };

    // ---------------------------------------------------------------------
    // 外框：G2 连续曲率圆角（直边 → 曲率线性爬升 → 定曲率圆弧 → 对称回落）
    // 曲率 κ(s) 在整条轮廓上连续，没有圆角处的曲率跳变；β 控制向外膨胀量。
    // ---------------------------------------------------------------------
    const FRAME_SIZE = 28;        // 热区
    const FRAME_BULGE = 1;        // 向外膨胀（每边 px），框因此比热区大 2px
    const FRAME_RADIUS = 8;       // 中段定曲率圆的半径（κ = 1/R）
    const FRAME_TRANSITION = 4.4; // 每个圆角两端的 G2 过渡长度
    const FRAME_PADDING = 1;      // SVG 内留白，避免 1px 描边被裁

    const buildFramePath = (size, radius, transition, padding) => {
      const thetaR = transition / (2 * radius);
      const thetaA = Math.PI / 2 - 2 * thetaR;
      if (!(thetaA > 0)) return '';
      const total = 2 * transition + radius * thetaA;
      const samples = 44;
      const subSteps = 10;
      const h = total / (samples * subSteps);
      const kappaAt = (u) => {
        if (u <= 0) return 0;
        if (u < transition) return u / (radius * transition);
        if (u < transition + radius * thetaA) return 1 / radius;
        if (u < total) return (total - u) / (radius * transition);
        return 0;
      };
      let x = 0;
      let y = 0;
      let theta = 0;
      let s = 0;
      const corner = [[0, 0]];
      for (let i = 0; i < samples * subSteps; i += 1) {
        const kMid = kappaAt(s + h / 2);
        const thMid = theta + kMid * h / 2;
        x += Math.cos(thMid) * h;
        y += Math.sin(thMid) * h;
        theta += kappaAt(s + h) * h;
        s += h;
        if ((i + 1) % subSteps === 0) corner.push([x, y]);
      }
      corner.push([x, y]);
      const endX = x;
      // 放到方形右下角，再绕中心旋转出四个角
      const placed = corner.map(([px, py]) => [size - endX + px + padding, py + padding]);
      const rotate = (point, degrees) => {
        const angle = (degrees * Math.PI) / 180;
        const center = size / 2 + padding;
        const dx = point[0] - center;
        const dy = point[1] - center;
        return [center + dx * Math.cos(angle) - dy * Math.sin(angle), center + dx * Math.sin(angle) + dy * Math.cos(angle)];
      };
      const pieces = [0, 90, 180, 270].map((degrees) => placed.map((point) => rotate(point, degrees)));
      const fmt = (value) => value.toFixed(2);
      let d = '';
      for (let i = 0; i < pieces.length; i += 1) {
        const piece = pieces[i];
        if (i === 0) d += 'M ' + fmt(piece[0][0]) + ' ' + fmt(piece[0][1]);
        for (let k = 1; k < piece.length; k += 1) {
          d += ' L ' + fmt(piece[k][0]) + ' ' + fmt(piece[k][1]);
        }
        const next = pieces[(i + 1) % pieces.length][0];
        d += ' L ' + fmt(next[0]) + ' ' + fmt(next[1]);
      }
      return d + ' Z';
    };

    const FRAME_BOX = FRAME_SIZE + FRAME_BULGE * 2;
    const FRAME_PATH = buildFramePath(FRAME_BOX, FRAME_RADIUS, FRAME_TRANSITION, FRAME_PADDING);
    const FRAME_VIEW = FRAME_BOX + FRAME_PADDING * 2; // svg 尺寸
    const FRAME_INSET = -(FRAME_VIEW - FRAME_SIZE) / 2;

    const CSS = `
      :where(.mss-trigger, .mss-scrim){
        --mss-primary: var(--dsw-alias-state-business-primary, #4176e6);
        --mss-hover: var(--dsw-alias-interactive-bg-hover, rgba(38,49,72,.06));
        --mss-hover-soft: var(--dsw-alias-interactive-bg-hover, rgba(38,49,72,.05));
        --mss-hover-strong: var(--dsw-alias-interactive-bg-hover, rgba(38,49,72,.08));
      }
      .mss-trigger{position:relative;display:flex;align-items:center;justify-content:center;width:28px;height:28px;
        padding:0;margin:0 2px 0 0;border:0;background:transparent;color:inherit;opacity:.8;cursor:pointer;
        line-height:1;box-sizing:border-box;user-select:none;-webkit-user-select:none}
      .mss-trigger:hover{opacity:1}
      .mss-trigger:focus-visible{outline:none;opacity:1}
      .mss-frame{position:absolute;pointer-events:none;overflow:visible;color:inherit}
      .mss-frame-fill{fill:currentColor;stroke:none;opacity:0;transition:opacity 120ms ease}
      .mss-frame-line{fill:none;stroke:currentColor;stroke-width:1;opacity:.26;transition:opacity 120ms ease}
      .mss-trigger:hover .mss-frame-line{opacity:.62}
      .mss-trigger:hover .mss-frame-fill{opacity:.045}
      .mss-trigger:focus-visible .mss-frame-line{stroke:var(--mss-primary);opacity:1}
      .mss-trigger:focus-visible .mss-frame-fill{opacity:.06}
      /* ∑ 的墨迹天然偏下：line-height:0 让行内盒贴住盒子中心，再用墨迹中心差把它挪正 */
      .mss-trigger .mss-sigma{position:relative;z-index:1;display:block;font-size:12px;line-height:0;
        transform:translateY(var(--mss-ink-center, -2.1px))}
      .mss-scrim{position:fixed;inset:0;z-index:600;background:rgba(15,17,21,.28);display:grid;place-items:center;padding:24px}
      .mss-dialog{position:relative;width:min(660px, calc(100vw - 48px));max-height:calc(100vh - 64px);display:flex;flex-direction:column;
        background:var(--dsw-alias-bg-base, #fff);color:inherit;border:1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08));
        border-radius:16px;box-shadow:0 24px 64px rgba(15,17,21,.24),0 2px 8px rgba(15,17,21,.08);overflow:hidden}
      .mss-head{display:flex;align-items:flex-start;gap:10px;padding:18px 20px 10px}
      .mss-head h2{margin:0;font-size:16px;font-weight:600}
      .mss-head p{margin:3px 0 0;font-size:12px;opacity:.6}
      .mss-close{margin-left:auto;width:28px;height:28px;border:none;background:transparent;color:inherit;opacity:.5;
        font-size:17px;line-height:1;border-radius:8px;cursor:pointer}
      .mss-close:hover{opacity:.9;background:var(--mss-hover)}
      .mss-mode{font:inherit;font-size:12px;padding:4px 10px;border-radius:999px;cursor:pointer;
        border:1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.14));background:transparent;color:inherit;opacity:.75}
      .mss-mode:hover{opacity:1;background:var(--mss-hover)}
      .mss-mode-on{background:var(--mss-primary);border-color:transparent;color:#fff;opacity:1}
      .mss-drafttext{flex:1;min-width:0;font-family:"Cambria Math",Consolas,monospace;font-size:15px;opacity:.85;
        white-space:pre-wrap;word-break:break-all}
      .mss-search-wrap{padding:0 20px}
      .mss-search{width:100%;height:36px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.12));
        background:var(--dsw-alias-bg-module-platform, rgba(128,128,128,.05));color:inherit;padding:0 12px;
        font:inherit;font-size:13px;outline:none;box-sizing:border-box}
      .mss-search::placeholder{opacity:.45}
      .mss-search:focus{border-color:var(--mss-primary)}
      .mss-tabs{display:flex;gap:2px;padding:2px 20px 0;overflow-x:auto;
        border-bottom:1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08))}
      .mss-tab{flex:none;border:none;border-bottom:2px solid transparent;border-radius:8px 8px 0 0;background:transparent;
        color:inherit;font:inherit;font-size:12.5px;padding:8px 11px 7px;cursor:pointer;opacity:.6;white-space:nowrap}
      .mss-tab:hover{opacity:.95;background:var(--mss-hover)}
      .mss-tab-on{opacity:1;color:var(--mss-primary);border-bottom-color:var(--mss-primary);font-weight:600}
      .mss-recent{display:flex;align-items:flex-start;gap:10px;padding:10px 20px 2px}
      .mss-recent-cells .mss-cell{padding:4px 3px 3px}
      .mss-recent-cells .mss-glyph{font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .mss-body{padding:10px 20px 0;overflow:auto;flex:1;min-height:100px}
      .mss-sect{display:flex;align-items:flex-start;gap:10px;padding:6px 0}
      .mss-sect + .mss-sect{border-top:1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08))}
      .mss-sname{width:84px;flex:none;font-size:11.5px;opacity:.55;padding-top:9px;line-height:1.4}
      .mss-cells{display:grid;grid-template-columns:repeat(6, minmax(0, 1fr));gap:7px;flex:1;min-width:0}
      .mss-cellwrap{flex:1;min-width:0}
      /* 模板区用虚线框和符号区区分：先符号、后模板，模板区为空时不渲染。 */
      .mss-tplgrid{border:1px dashed var(--dsw-alias-border-l1, rgba(0,0,0,.2));border-radius:10px;
        padding:8px;background:transparent}
      .mss-cell-tpl{background:var(--dsw-alias-bg-module-platform, rgba(128,128,128,.03))}
      .mss-letters{grid-template-columns:repeat(13, minmax(0, 1fr));gap:5px;margin-top:7px}
      .mss-letters .mss-cell{padding:5px 2px 4px}
      .mss-letters .mss-glyph{font-size:13px}
      .mss-toggle .mss-glyph{font-family:inherit;font-size:12px;opacity:.8}
      .mss-toggle .mss-code{opacity:.45}
      .mss-toggle.mss-cell-on{border-color:var(--mss-primary);color:var(--mss-primary)}
      .mss-cell{border:1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.1));border-radius:9px;background:transparent;
        color:inherit;padding:7px 4px 6px;text-align:center;cursor:pointer;font:inherit}
      .mss-cell:hover{background:var(--mss-hover-soft)}
      .mss-glyph{font-family:"Cambria Math","Segoe UI",serif;font-size:15px;line-height:1.25}
      .mss-code{font-size:10px;opacity:.55;margin-top:1px;font-family:Consolas,"SF Mono",monospace}
      .mss-keypad{display:flex;align-items:center;gap:6px;padding:2px 20px 10px;flex-wrap:wrap}
      .mss-key{min-width:32px;height:30px;padding:0 9px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.14));
        background:transparent;color:inherit;font:inherit;font-size:13px;cursor:pointer}
      .mss-key:hover{background:var(--mss-hover)}
      .mss-key-space{color:inherit;opacity:.75;font-size:12px}
      .mss-key-on{background:var(--mss-primary);border-color:transparent;color:#fff}
      .mss-key-off{opacity:.35;cursor:default}
      .mss-key-off:hover{background:transparent}
      .mss-numwrap{position:relative;display:inline-flex;margin-left:auto}
      .mss-numpop{position:absolute;right:0;bottom:calc(100% + 8px);z-index:8;display:grid;
        grid-template-columns:repeat(3, minmax(0, 1fr));gap:6px;padding:10px;border-radius:12px;width:180px;
        background:var(--dsw-alias-bg-base, #1b2028);background-image:linear-gradient(rgba(20,25,32,.02), rgba(20,25,32,.02));
        border:1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.12));
        box-shadow:0 16px 40px rgba(15,17,21,.28)}
      .mss-numkey{width:100%;height:40px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.14));
        background:transparent;color:inherit;font:inherit;font-size:15px;cursor:pointer}
      .mss-numkey:hover{background:var(--mss-hover)}
      .mss-suprow{display:flex;gap:6px;width:100%;margin-top:7px;padding-top:8px;
        border-top:1px dashed var(--dsw-alias-border-l1, rgba(0,0,0,.12))}
      .mss-cell-focus{outline:2px solid var(--mss-primary);outline-offset:-2px;
        background:var(--mss-hover-strong)}
      .mss-flash{color:var(--mss-primary);font-weight:500}
      .mss-modewrap{position:relative;display:inline-flex}
      .mss-toast{position:absolute;left:50%;top:calc(100% + 8px);transform:translateX(-50%);
        padding:4px 9px;border-radius:999px;z-index:2;
        background:var(--mss-primary);color:#fff;font-size:11.5px;font-weight:500;
        pointer-events:none;white-space:nowrap;animation:mss-toast 1.4s ease forwards}
      @keyframes mss-toast{
        0%{opacity:0}
        12%{opacity:1}
        78%{opacity:1}
        100%{opacity:0}
      }
      .mss-copy{margin-left:8px;flex:none;border:1px solid var(--dsw-alias-border-l2, rgba(38,49,72,.18));
        border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary, #5c6470);
        font:inherit;font-size:12px;padding:5px 10px;cursor:pointer}
      .mss-copy:hover{background:var(--mss-hover)}
      @media (max-width:720px){
        .mss-cells{grid-template-columns:repeat(4, minmax(0, 1fr))}
        .mss-letters{grid-template-columns:repeat(7, minmax(0, 1fr))}
      }
      /* 最近条固定 6 列 × 2 行（12 个），窄屏也不跟着降列，避免从两行变三行。 */
      .mss-recent-cells{grid-template-columns:repeat(6, minmax(0, 1fr))}
      .mss-slotpage{position:absolute;left:10px;right:10px;top:58px;bottom:10px;z-index:6;
        display:flex;flex-direction:column;gap:12px;padding:16px;border-radius:14px;
        background:var(--dsw-alias-bg-base, #fff);box-shadow:0 14px 44px rgba(20,30,60,.2)}
      .mss-slothead{display:flex;align-items:center;gap:10px}
      .mss-slotback{border:none;background:transparent;color:inherit;opacity:.7;font:inherit;font-size:12.5px;
        cursor:pointer;padding:4px 6px;border-radius:6px}
      .mss-slotback:hover{background:var(--mss-hover)}
      .mss-slottitle{font-size:13.5px;font-weight:600}
      .mss-slotform{display:flex;align-items:flex-end;gap:10px;flex-wrap:wrap}
      .mss-slotfield{display:flex;flex-direction:column;gap:4px}
      .mss-slotcap{font-size:11px;opacity:.55}
      .mss-slotchips{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
      .mss-slotlabel{font-family:"Cambria Math",serif;font-size:15px}
      .mss-slotchip{min-width:44px;text-align:center;border:1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.14));
        border-radius:8px;padding:4px 8px;font-size:13px}
      .mss-slotchip.on{border-color:var(--mss-primary);
        box-shadow:0 0 0 3px rgba(65,118,230,.10)}
      .mss-slotops{opacity:.5;font-size:12px}
      .mss-slotinput{border:1px solid var(--mss-primary);border-radius:9px;
        padding:9px 11px;font:inherit;font-size:15px;background:var(--dsw-alias-bg-base, #fff);color:inherit;outline:none}
      .mss-slotgrid{display:grid;grid-template-columns:repeat(6, minmax(0, 1fr));gap:6px;overflow:auto;flex:1;align-content:start}
      .mss-slotkey{border:1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.12));border-radius:8px;background:transparent;
        color:inherit;font-family:"Cambria Math",serif;font-size:14px;padding:7px 4px;cursor:pointer}
      .mss-slotkey:hover{background:var(--mss-hover)}
      .mss-slothint{font-size:11.5px;opacity:.55}
      .mss-draft{margin:0 20px;border-top:1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08));padding-top:12px}
      .mss-draftrow{display:flex;align-items:center;gap:10px;min-height:44px;padding:8px 10px;border-radius:10px;
        border:1px solid var(--mss-primary);
        box-shadow:0 0 0 3px rgba(65,118,230,.08);background:var(--dsw-alias-bg-base, #fff)}
      .mss-drafttag{font-size:11px;opacity:.5;flex:none}
      .mss-draftinput{flex:1;min-width:0;border:none;outline:none;background:transparent;color:inherit;
        font-family:"Cambria Math",Consolas,monospace;font-size:16px}
      .mss-draftinput::placeholder{opacity:.4;font-family:inherit;font-size:13px}
      .mss-preview{display:flex;align-items:baseline;gap:8px;padding:8px 2px 0;font-size:12px;opacity:.8;min-height:22px}
      .mss-preview .mss-lbl{opacity:.6}
      .mss-preview .mss-math{font-family:"Cambria Math",serif;font-size:14px}
      .mss-preview .mss-note{opacity:.55;font-size:11.5px}
      .mss-foot{display:flex;align-items:center;gap:10px;margin:14px 20px 18px}
      .mss-version{font-size:10.5px;opacity:.35;font-family:Consolas,"SF Mono",monospace;letter-spacing:.02em}
      .mss-hint{font-size:11.5px;opacity:.5}
      .mss-kbd{font-family:Consolas,monospace;font-size:10.5px;border:1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.16));
        border-bottom-width:2px;border-radius:4px;padding:0 4px}
      .mss-btn{font:inherit;font-size:13px;border-radius:9px;padding:8px 14px;cursor:pointer;
        border:1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.14));background:transparent;color:inherit;opacity:.85}
      .mss-btn:hover{opacity:1;background:var(--mss-hover)}
      .mss-btn-primary{background:var(--mss-primary);border-color:transparent;color:#fff;opacity:1;font-weight:500}
      .mss-btn-primary:disabled{opacity:.45;cursor:default}
      .mss-foot .mss-spacer{flex:1}
    `;

    // 样式必须由 apply 一次性挂到 <head>，不能只放在弹窗里：
    // 弹窗关闭时组件返回 null，样式会跟着卸载，触发按钮就退回浏览器默认样式。
    const installStyles = () => {
      if (typeof document === 'undefined') return () => {};
      const tag = document.createElement('style');
      tag.dataset.plugin = 'dsh-mathpad';
      tag.dataset.pluginCss = 'dsh-mathpad/client.css';
      tag.textContent = CSS;
      document.head.appendChild(tag);
      return () => { tag.remove(); };
    };

    // ---------------------------------------------------------------------
    // 触发按钮（输入框右下角、识图左侧的一枚图标）
    // ---------------------------------------------------------------------
    let latestActions = null;

    function MathSymbolsTrigger(props) {
      const actions = props === null || props === undefined ? undefined : props.inputActions;
      if (actions !== undefined && actions !== null) latestActions = actions;
      const disabled = actions === undefined;
      const glyphRef = React.useRef(null);
      React.useEffect(() => { centerGlyphInk(glyphRef.current); }, []);
      const frame = h('svg', {
        className: 'mss-frame',
        width: FRAME_VIEW,
        height: FRAME_VIEW,
        viewBox: '0 0 ' + FRAME_VIEW + ' ' + FRAME_VIEW,
        'aria-hidden': 'true',
        focusable: 'false',
        style: { left: FRAME_INSET, top: FRAME_INSET },
      },
        h('path', { className: 'mss-frame-fill', d: FRAME_PATH }),
        h('path', { className: 'mss-frame-line', d: FRAME_PATH }),
      );
      return h('div', {
        role: 'button',
        tabIndex: disabled ? -1 : 0,
        className: 'mss-trigger',
        title: '数学符号面板',
        'aria-label': '数学符号面板',
        'aria-disabled': disabled ? 'true' : undefined,
        onMouseDown: keepFocus,
        onClick: () => { if (!disabled) openPanel(actions); },
        onKeyDown: (event) => {
          if (disabled) return;
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openPanel(actions);
          }
        },
        style: disabled ? { opacity: 0.35, cursor: 'default' } : undefined,
      }, frame, h('span', { className: 'mss-sigma', ref: glyphRef }, '∑'));
    }

    // ---------------------------------------------------------------------
    // 弹窗（shell.overlay）
    // ---------------------------------------------------------------------
    function MathSymbolsDialog() {
      const state = stateHook();
      const draftRef = React.useRef(null);
      const caretTarget = React.useRef(null);
      const numRef = React.useRef(null);
      const slotRefs = [React.useRef(null), React.useRef(null)];

      React.useEffect(() => {
        if (state.slot === null) return;
        const input = slotRefs[state.slot.focus].current;
        if (input !== null && typeof input.focus === 'function') input.focus();
      }, [state.slot === null ? '' : state.slot.kind, state.slot === null ? -1 : state.slot.focus]);

      React.useEffect(() => {
        if (!state.open || state.direct) return;
        if (draftRef.current !== null) draftRef.current.focus();
      }, [state.open, state.direct]);

      // 插入片段后把光标放回草稿里正确的位置（渲染完成再设）。
      React.useEffect(() => {
        if (caretTarget.current === null) return;
        const input = draftRef.current;
        const position = caretTarget.current;
        caretTarget.current = null;
        if (input === null) return;
        input.focus();
        if (typeof input.setSelectionRange === 'function') {
          try { input.setSelectionRange(position, position); } catch { /* 非文本框时忽略 */ }
        }
      });

      // 数字弹窗：点弹窗外面收起；点「数字」按钮自己不算外面。
      React.useEffect(() => {
        if (!state.open || !state.num) return () => {};
        if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return () => {};
        const onPointerDown = (event) => {
          const wrap = numRef.current;
          const target = event === null || event === undefined ? null : event.target;
          const inside = wrap !== null && wrap !== undefined && typeof wrap.contains === 'function'
            && target !== null && target !== undefined && wrap.contains(target);
          if (inside) return;
          patchPanel({ num: false });
        };
        document.addEventListener('mousedown', onPointerDown);
        return () => { document.removeEventListener('mousedown', onPointerDown); };
      }, [state.open, state.num]);

      if (!state.open) return null;

      const caret = () => {
        const input = draftRef.current;
        // 草稿框有焦点时以真实选区为准，否则用最后记住的位置，最后才落到末尾。
        if (input !== null && typeof input.selectionStart === 'number'
          && typeof document !== 'undefined' && document.activeElement === input) {
          return Math.min(input.selectionStart, state.text.length);
        }
        if (caretPosition !== null) return Math.min(caretPosition, state.text.length);
        return state.text.length;
      };
      const caretEnd = () => {
        const input = draftRef.current;
        if (input !== null && typeof input.selectionEnd === 'number'
          && typeof document !== 'undefined' && document.activeElement === input) {
          return Math.min(input.selectionEnd, state.text.length);
        }
        return caret();
      };

      const putText = (next, position) => {
        patchPanel({ text: next });
        caretPosition = position;
        caretTarget.current = position;
      };

      // 优先走输入框原生编辑，浏览器自己的 Ctrl+Z 撤销栈才能记住这一步。
      const replaceRange = (start, end, replacement, caretAfter) => {
        const input = draftRef.current;
        const canCommand = input !== null && typeof document !== 'undefined'
          && document.activeElement === input && typeof document.execCommand === 'function';
        if (canCommand) {
          input.focus();
          input.setSelectionRange(start, end);
          document.execCommand('insertText', false, replacement);
          const position = caretAfter === undefined ? start + replacement.length : caretAfter;
          input.setSelectionRange(position, position);
          caretPosition = position;
          caretTarget.current = position;
          return;
        }
        putText(state.text.slice(0, start) + replacement + state.text.slice(end),
          caretAfter === undefined ? start + replacement.length : caretAfter);
      };

      const insertSnippet = (snippet) => {
        if (state.direct) { insertDirect(snippet); rememberRecent(snippet); flash('✅ 已插入 ' + snippet); return; }
        const start = caret();
        const end = caretEnd();
        replaceRange(start, end, snippet);
        rememberRecent(snippet);
        flash('✅ 已插入 ' + snippet);
      };

      // 模板：插入一段文本，并把光标放到模板内部（例如分式的分子）。
      const insertTemplate = (template, offset) => {
        if (state.direct) { insertDirect(template); rememberRecent(template); flash('✅ 已插入模板'); return; }
        const start = caret();
        const end = caretEnd();
        replaceRange(start, end, template, start + offset);
        rememberRecent(template);
        flash('✅ 已插入模板');
      };

      const openSlot = (kind) => {
        patchPanel({
          slot: { kind, values: ['', ''], focus: 0 },
          slotStart: caret(),
          slotEnd: caretEnd(),
          mode: 'idle',
          num: false,
          flash: '',
        });
      };

      const slotAppend = (char) => {
        const slot = state.slot;
        if (slot === null) return;
        const index = slot.focus;
        const input = slotRefs[index].current;
        const current = input !== null && typeof input.value === 'string' ? input.value : (slot.values[index] ?? '');
        const next = current + char;
        if (input !== null && typeof input.value === 'string') {
          input.value = next;
          input.focus();
          if (typeof input.setSelectionRange === 'function') {
            try { input.setSelectionRange(next.length, next.length); } catch { /* 忽略 */ }
          }
        }
        const values = slot.values.slice();
        values[index] = next;
        patchPanel({ slot: { ...slot, values } });
      };

      const slotKeyDown = (event) => {
        if (event.key === 'Escape') { event.stopPropagation(); patchPanel({ slot: null }); return; }
        if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); slotCommit(); }
      };

      const slotCommit = () => {
        const slot = state.slot;
        if (slot === null) return;
        const read = (ref) => (ref.current !== null && typeof ref.current.value === 'string'
          ? ref.current.value
          : null);
        const from = read(slotRefs[0]) ?? slot.values[0] ?? '';
        const to = read(slotRefs[1]) ?? slot.values[1] ?? '';
        const spec = SLOT_SPECS[slot.kind] ?? SLOT_SPECS.int;
        const filled = spec.build(from, to);
        replaceRange(state.slotStart, state.slotEnd, filled);
        rememberRecent(filled);
        patchPanel({ slot: null, slotStart: 0, slotEnd: 0 });
        flash('✅ 已插入模板');
      };

      const backspace = () => {
        const start = caret();
        const end = caretEnd();
        if (start === end) {
          if (start === 0) return;
          const tokenStart = tokenStartBefore(state.text, start);
          const next = tokenStart === null ? start - 1 : tokenStart;
          replaceRange(next, start, '', next);
          return;
        }
        replaceRange(start, end, '', start);
      };

      // 底部编辑条：← / → 按字符移动草稿光标（直插模式没有本地草稿，按钮禁用）。
      const moveCaretBy = (delta) => {
        if (state.direct) return;
        const next = Math.max(0, Math.min(state.text.length, caret() + delta));
        caretPosition = next;
        caretTarget.current = next;
        patchPanel({});
      };

      // 底部编辑条：清空。草稿模式清文本，直插模式清「已写入」记录。
      const clearDraft = () => {
        if (state.direct) {
          patchPanel({ chain: [] });
          flash('已清空');
          return;
        }
        putText('', 0);
        flash('已清空');
      };

      // 切页签：重置焦点（页签内的选中环收起），数字弹窗也一并收起。
      const switchTab = (id) => {
        patchPanel({ tab: id, focusIndex: 0, mode: 'idle', num: false });
      };

      const scrim = (event) => {
        if (event.target === event.currentTarget) closePanel();
      };

      const sourceText = state.direct ? state.chain.join('') : state.text;
      const reading = state.latex ? toLatex(sourceText) : explain(sourceText);

      const activeGroup = groupOf(state.tab);
      const symbols = activeGroup.items;
      const templates = activeGroup.templates;
      const navLength = symbols.length + templates.length;
      const COLS = (typeof window !== 'undefined' && window.innerWidth <= 720) ? 4 : 6;

      // 页签内的导航 = 符号 + 模板 一条列表；页签之间用 Tab 切。
      const setFocus = (index, mode) => {
        patchPanel({
          tab: activeGroup.id,
          focusIndex: Math.min(navLength - 1, Math.max(0, index)),
          mode,
        });
      };
      const moveFocus = (dx, dy) => {
        if (navLength === 0) return;
        setFocus(state.focusIndex + dx + dy, 'selected');
      };

      // 输出：普通项插文本，带 offset 的当模板插，带 meta 的打开填空页。
      const runItem = (item) => {
        if (item === undefined) return;
        if (item[4] !== undefined) openSlot(item[4]);
        else if (item[3] === undefined) insertSnippet(item[1]);
        else insertTemplate(item[1], item[3]);
      };
      const triggerFocused = () => {
        const index = Math.min(navLength - 1, Math.max(0, state.focusIndex));
        if (index < symbols.length) { runItem(symbols[index]); return; }
        runItem(templates[index - symbols.length]);
      };

      const onDraftKeyDown = (event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          if (state.num) { patchPanel({ num: false }); return; }
          closePanel();
          return;
        }
        if (event.key === 'Backspace') {
          const input = event.currentTarget;
          const start = typeof input.selectionStart === 'number' ? input.selectionStart : state.text.length;
          const end = typeof input.selectionEnd === 'number' ? input.selectionEnd : start;
          if (start === end) {
            const tokenStart = tokenStartBefore(state.text, start);
            if (tokenStart !== null) {
              event.preventDefault();
              putText(state.text.slice(0, tokenStart) + state.text.slice(start), tokenStart);
            }
          }
          return;
        }
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          event.stopPropagation();
          // 方向键选中了格子时，Enter 输出那个格子，而不是被“空草稿”吞掉。
          if (state.mode === 'selected') {
            triggerFocused();
            return;
          }
          insertDraft();
        }
      };

      // 底部编辑条：← → 空格 ⌫ 删除 清空（数字按钮和弹窗单独渲染，便于定位）。
      const KEYS = [
        { id: 'left', label: '←', title: '光标左移一位（草稿模式）', off: state.direct, run: () => moveCaretBy(-1) },
        { id: 'right', label: '→', title: '光标右移一位（草稿模式）', off: state.direct, run: () => moveCaretBy(1) },
        { id: 'space', label: '空格', title: '普通空格', run: () => insertSnippet(' ') },
        { id: 'slash', label: '/', title: '斜杠 /', run: () => insertSnippet('/') },
        ...(state.direct ? [] : [{ id: 'backspace', label: '⌫ 删除', title: '删除光标前的一个符号（整个符号删除）', run: backspace }]),
        { id: 'clear', label: '清空', title: state.direct ? '清空已写入记录' : '清空草稿', run: clearDraft },
      ];

      const onKeyDown = (event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          if (state.slot !== null) { patchPanel({ slot: null }); return; }
          if (state.num) { patchPanel({ num: false }); return; }
          closePanel();
          return;
        }
        if (state.slot !== null) return;
        // 鼠标在草稿区时，方向键交给输入框移动光标，不抢。
        if (state.pointerInDraft && event.key.startsWith('Arrow')) return;
        if (event.key === 'ArrowRight') { event.preventDefault(); moveFocus(1, 0); return; }
        if (event.key === 'ArrowLeft') { event.preventDefault(); moveFocus(-1, 0); return; }
        if (event.key === 'ArrowDown') { event.preventDefault(); moveFocus(0, COLS); return; }
        if (event.key === 'ArrowUp') { event.preventDefault(); moveFocus(0, -COLS); return; }
        if (event.key === 'Tab') {
          event.preventDefault();
          if (event.shiftKey) {
            setLatexMode(!state.latex);
            return;
          }
          const index = TAB_IDS.indexOf(state.tab);
          switchTab(TAB_IDS[(index + 1 + TAB_IDS.length) % TAB_IDS.length]);
          return;
        }
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          // Enter 输出当前选中项；没有选中项时才退化为插入草稿（空草稿不关面板）。
          if (state.mode !== 'selected') {
            if (!state.direct) insertDraft();
            return;
          }
          triggerFocused();
        }
        if (event.key === 'Backspace' && event.metaKey) { event.preventDefault(); putText('', 0); }
      };

      // 单元格：符号和模板共用一个渲染器，模板用虚线框区分。
      const renderCell = (item, index, isTemplate) => {
        const focused = state.mode === 'selected' && state.focusIndex === index;
        return h('button', {
          key: (isTemplate ? 'tpl-' : 'sym-') + index + '-' + item[1],
          type: 'button',
          className: 'mss-cell'
            + (isTemplate ? ' mss-cell-tpl' : '')
            + (focused ? ' mss-cell-focus' : ''),
          title: '插入 ' + item[1],
          onMouseDown: keepFocus,
          onMouseEnter: () => patchPanel({ tab: activeGroup.id, focusIndex: index, mode: 'selected' }),
          onClick: () => {
            patchPanel({ tab: activeGroup.id, focusIndex: index, mode: 'selected' });
            runItem(item);
          },
        },
          h('div', { className: 'mss-glyph' }, item[0]),
          h('div', { className: 'mss-code' }, item[1] === ' ' ? '空格' : item[1]),
        );
      };

      // 「最近」常驻条：固定在页签上方，最多 12 个（6 列 × 2 行）。
      const recentBar = recentItems.length === 0 ? null : h('div', { className: 'mss-recent' },
        h('div', { className: 'mss-sname' }, '最近'),
        h('div', { className: 'mss-cellwrap' },
          h('div', { className: 'mss-cells mss-recent-cells' },
            recentItems.map((item) => h('button', {
              key: 'recent-' + item.text,
              type: 'button',
              className: 'mss-cell mss-recent-cell',
              title: '插入 ' + item.text,
              onMouseDown: keepFocus,
              onClick: () => insertSnippet(item.text),
            }, h('div', { className: 'mss-glyph' }, item.label)))),
        ),
      );

      const tabBar = h('div', { className: 'mss-tabs', role: 'tablist' },
        GROUPS.map((entry) => h('button', {
          key: 'tab-' + entry.id,
          type: 'button',
          role: 'tab',
          'aria-selected': state.tab === entry.id ? 'true' : 'false',
          className: 'mss-tab' + (state.tab === entry.id ? ' mss-tab-on' : ''),
          title: '切到' + entry.name,
          onMouseDown: keepFocus,
          onClick: () => switchTab(entry.id),
        }, entry.name)),
      );

      // 页签内先「符号」网格（6 列），再「模板」网格（虚线框）。
      const symbolBlock = h('div', {
        className: 'mss-sect',
        onMouseEnter: () => patchPanel({ tab: activeGroup.id, focusIndex: 0, mode: 'selected' }),
      },
        h('div', { className: 'mss-sname' }, '符号'),
        h('div', { className: 'mss-cellwrap' },
          h('div', { className: 'mss-cells' },
            symbols.map((item, index) => renderCell(item, index, false)),
            activeGroup.id === 'vars'
              ? h('button', {
                key: 'letters-toggle',
                type: 'button',
                className: 'mss-cell mss-toggle',
                title: state.letters ? '收起字母条' : '展开 a–z',
                onMouseDown: keepFocus,
                onClick: () => patchPanel({ letters: !state.letters }),
              },
                h('div', { className: 'mss-glyph' }, 'a–z'),
                h('div', { className: 'mss-code' }, state.letters ? '收起' : '展开'),
              )
              : null,
          ),
          activeGroup.id === 'vars' && state.letters
            ? h('div', { className: 'mss-cells mss-letters' },
              LETTER_CELLS.map((item) => h('button', {
                key: 'letter-' + item.text,
                type: 'button',
                className: 'mss-cell mss-letter-cell',
                title: '插入 ' + item.text,
                onMouseDown: keepFocus,
                onClick: () => insertSnippet(item.text),
              }, h('div', { className: 'mss-glyph' }, item.glyph))),
            )
            : null,
        ),
      );

      // 模板区没有内容就整块不渲染（连标题一起）。ⁿ 上标开关挂在「运算/结构」的模板区。
      const templateBlock = templates.length === 0 ? null : h('div', {
        className: 'mss-sect',
        onMouseEnter: () => patchPanel({ tab: activeGroup.id, focusIndex: symbols.length, mode: 'selected' }),
      },
        h('div', { className: 'mss-sname' }, '模板'),
        h('div', { className: 'mss-cellwrap' },
          h('div', { className: 'mss-cells mss-tplgrid' },
            templates.map((item, index) => renderCell(item, symbols.length + index, true)),
            activeGroup.id === 'ops'
              ? h('button', {
                key: 'sup-toggle',
                type: 'button',
                className: 'mss-cell mss-toggle' + (state.sup ? ' mss-cell-on' : ''),
                title: state.sup ? '收起上标数字' : '展开上标数字（幂次）',
                onMouseDown: keepFocus,
                onClick: () => patchPanel({ sup: !state.sup }),
              },
                h('div', { className: 'mss-glyph' }, 'ⁿ'),
                h('div', { className: 'mss-code' }, state.sup ? '收起' : '上标'),
              )
              : null,
          ),
          activeGroup.id === 'ops' && state.sup
            ? h('div', { className: 'mss-suprow' },
              SUPERSCRIPT_DIGITS.map((glyph) => h('button', {
                key: 'sup-' + glyph,
                type: 'button',
                className: 'mss-key',
                title: '上标 ' + glyph,
                onMouseDown: keepFocus,
                onClick: () => insertSnippet(glyph),
              }, glyph)),
              h('button', {
                key: 'sup-n',
                type: 'button',
                className: 'mss-key',
                title: '上标 n',
                onMouseDown: keepFocus,
                onClick: () => insertSnippet('ⁿ'),
              }, 'ⁿ'))
            : null,
        ),
      );

      const slotSpec = state.slot === null ? null : (SLOT_SPECS[state.slot.kind] ?? SLOT_SPECS.int);

      return h(React.Fragment, null,
        h('div', { key: 'mss-scrim', className: 'mss-scrim', onMouseDown: scrim, onKeyDown },
          h('div', { className: 'mss-dialog', role: 'dialog', 'aria-label': '数学符号' },
            h('div', { className: 'mss-head' },
              h('div', null,
                h('h2', null, state.direct ? '数学符号 · 直插' : '数学符号'),
                h('p', null, state.direct
                  ? '点符号/数字直接写进聊天框，面板不关，可以连着点'
                  : '点符号填空、直接改草稿 · 插入到输入框光标处'),
              ),
              h('span', { className: 'mss-modewrap' },
                h('button', {
                  type: 'button',
                  className: 'mss-mode',
                  title: state.direct ? '切回草稿模式' : '切成直插模式',
                  onClick: () => setDirectMode(!state.direct),
                }, state.direct ? '⇢ 直插' : '⌨ 草稿'),
                state.flash === '' ? null : h('span', { className: 'mss-toast' }, state.flash),
              ),
              h('button', {
                type: 'button',
                className: 'mss-mode' + (state.latex ? ' mss-mode-on' : ''),
                title: '插入时把草稿转成 LaTeX',
                onClick: () => setLatexMode(!state.latex),
              }, state.latex ? 'TeX ✓' : 'TeX'),
              h('button', { type: 'button', className: 'mss-close', 'aria-label': '关闭', onClick: closePanel }, '×'),
            ),
            state.slot === null ? null : h('div', {
              className: 'mss-slotpage',
              onMouseDown: (event) => {
                const target = event.target;
                const interactive = target !== null && typeof target.closest === 'function'
                  && target.closest('button, input, label') !== null;
                if (!interactive) slotCommit();
              },
            },
              h('div', { className: 'mss-slothead' },
                h('button', {
                  type: 'button',
                  className: 'mss-slotback',
                  onClick: () => patchPanel({ slot: null }),
                }, '← 返回'),
                h('div', { className: 'mss-slottitle' }, slotSpec.title),
              ),
              h('div', { className: 'mss-slotform' },
                h('span', { className: 'mss-slotlabel' }, slotSpec.symbol),
                [0, 1].flatMap((index) => {
                  const field = h('label', { className: 'mss-slotfield', key: 'slot-field-' + index },
                    h('span', { className: 'mss-slotcap' }, slotSpec.labels[index]),
                    h('input', {
                      key: 'slot-' + index + '-' + state.slot.kind,
                      className: 'mss-slotinput' + (state.slot.focus === index ? ' on' : ''),
                      ref: slotRefs[index],
                      defaultValue: state.slot.values[index] ?? '',
                      placeholder: slotSpec.placeholders[index],
                      onFocus: () => patchPanel({ slot: { ...state.slot, focus: index } }),
                      onChange: (event) => {
                        const values = state.slot.values.slice();
                        values[index] = event.target.value;
                        patchPanel({ slot: { ...state.slot, values } });
                      },
                      onKeyDown: slotKeyDown,
                    }),
                  );
                  return index === 0
                    ? [field, h('span', { className: 'mss-slotops', key: 'slot-ops' }, slotSpec.join)]
                    : [field];
                }),
              ),
              h('div', { className: 'mss-slotgrid' },
                SLOT_VARS.map(([glyph, value]) => h('button', {
                  key: 'slot-var-' + value,
                  type: 'button',
                  className: 'mss-slotkey',
                  onMouseDown: keepFocus,
                  onClick: () => slotAppend(value),
                }, glyph)),
                ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'].map((digit) => h('button', {
                  key: 'slot-digit-' + digit,
                  type: 'button',
                  className: 'mss-slotkey',
                  onMouseDown: keepFocus,
                  onClick: () => slotAppend(digit),
                }, digit)),
              ),
              h('div', { className: 'mss-slothint' }, 'Enter 完成并返回 · 两个空都可以直接点'),
            ),
            recentBar,
            tabBar,
            h('div', {
              className: 'mss-body',
              onMouseLeave: () => patchPanel({ mode: 'idle' }),
            },
              symbolBlock,
              templateBlock,
            ),
            h('div', { className: 'mss-keypad' },
              KEYS.map((key) => h('button', {
                key: key.id,
                type: 'button',
                title: key.title,
                disabled: key.off === true,
                className: 'mss-key' + (key.off === true ? ' mss-key-off' : ''),
                onMouseDown: keepFocus,
                onClick: () => { if (key.off !== true) key.run(); },
              }, key.label)),
              h('div', { className: 'mss-numwrap', ref: numRef },
                h('button', {
                  key: 'num-toggle',
                  type: 'button',
                  title: '数字键盘：0-9 . /',
                  className: 'mss-key' + (state.num ? ' mss-key-on' : ''),
                  onMouseDown: keepFocus,
                  onClick: () => patchPanel({ num: !state.num }),
                }, '数字'),
                state.num
                  ? h('div', { key: 'num-pop', className: 'mss-numpop', role: 'group', 'aria-label': '数字键盘' },
                    NUM_KEYS.map((char) => h('button', {
                      key: 'num-' + char,
                      type: 'button',
                      className: 'mss-numkey',
                      title: '插入 ' + char,
                      onMouseDown: keepFocus,
                      onClick: () => insertSnippet(char),
                    }, char)))
                  : null,
              ),
            ),
            h('div', {
              className: 'mss-draft',
              onMouseEnter: () => patchPanel({ pointerInDraft: true }),
              onMouseLeave: () => patchPanel({ pointerInDraft: false }),
            },
              h('div', { className: 'mss-draftrow' },
                h('span', { className: 'mss-drafttag' }, state.direct ? '已写入' : '草稿'),
                state.direct
                  ? h('div', { className: 'mss-drafttext' },
                    state.chain.length === 0 ? '点符号，直接写进聊天框' : state.chain.join(''))
                  : h('input', {
                    ref: draftRef,
                    className: 'mss-draftinput',
                    placeholder: '点符号，或者直接在这里打字',
                    value: state.text,
                    onKeyDown: onDraftKeyDown,
                    onKeyUp: (event) => { caretPosition = event.currentTarget.selectionStart; },
                    onClick: (event) => { caretPosition = event.currentTarget.selectionStart; },
                    onSelect: (event) => { caretPosition = event.currentTarget.selectionStart; },
                    onChange: (event) => {
                      caretPosition = event.target.selectionStart;
                      patchPanel({ text: event.target.value, mode: 'idle' });
                    },
                  }),
                h('button', {
                  type: 'button',
                  className: 'mss-copy',
                  title: '复制草稿（TeX 模式下复制 LaTeX）',
                  onMouseDown: keepFocus,
                  onClick: () => {
                    const value = state.latex ? toLatex(sourceText) : sourceText;
                    if (value === '') { flash('还没有内容'); return; }
                    try {
                      if (typeof navigator !== 'undefined' && navigator.clipboard) {
                        navigator.clipboard.writeText(value);
                        flash('已复制');
                        return;
                      }
                    } catch { /* 落到下面 */ }
                    flash('复制不可用');
                  },
                }, '复制'),
              ),
              h('div', { className: 'mss-preview' },
                h('span', { className: 'mss-lbl' }, state.latex ? 'LaTeX' : '读作'),
                reading === ''
                  ? h('span', { className: 'mss-note' }, state.direct ? '还没点任何符号' : '还没有内容')
                  : h('span', { className: 'mss-math' }, reading),
                h('span', { className: 'mss-note' }, state.latex
                  ? '· 插入时用这段 LaTeX'
                  : '· sin²x → (sin x)²　· e3 → e³　· x5 → x⁵'),
              ),
            ),
            h('div', { className: 'mss-foot' },
              h('span', { className: 'mss-hint' },
                state.direct
                  ? h(React.Fragment, null, h('span', { className: 'mss-kbd' }, 'Esc'), ' 关闭')
                  : h(React.Fragment, null,
                    h('span', { className: 'mss-kbd' }, 'Enter'), ' 插入　',
                    h('span', { className: 'mss-kbd' }, 'Esc'), ' 关闭',
                  ),
              ),
              h('span', { className: 'mss-version' }, 'v' + VERSION),
              h('span', { className: 'mss-spacer' }),
              h('button', { type: 'button', className: 'mss-btn', onClick: closePanel }, state.direct ? '关闭' : '取消'),
              state.direct
                ? h('button', {
                  type: 'button',
                  className: 'mss-btn mss-btn-primary',
                  onClick: closePanel,
                }, '完成')
                : h('button', {
                  type: 'button',
                  className: 'mss-btn mss-btn-primary',
                  disabled: state.text.trim() === '',
                  onClick: insertDraft,
                }, '插入到输入框'),
            ),
          ),
        ),
      );
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        if (typeof ctx.effect === 'function') ctx.effect(() => installStyles(), 'math-symbols: styles');
        else installStyles();
        try {
          if (typeof console !== 'undefined' && typeof console.info === 'function') {
            console.info('[dsh-mathpad] client v' + VERSION + ' loaded — 改 client.js 后必须刷新页面（Ctrl+R）才会换模块');
          }
        } catch {
          /* 日志失败不影响功能 */
        }

        // order 1000：这个列表按升序排在模型选择器之前，最后一项就是紧贴模型左侧。
        // 以后若有插件用更大的 order，它会占住这个位置，我们自动往左移。
        ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
          name: 'conversation.input.right',
          id: 'math-symbols',
          order: 1000,
        }, MathSymbolsTrigger));

        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'math-symbols-panel',
        }, MathSymbolsDialog));

        // Ctrl+Shift+M：手不离键盘打开面板。
        if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
          const onShortcut = (event) => {
            if (event === null || event === undefined) return;
            if (!event.ctrlKey || !event.shiftKey) return;
            if (typeof event.key !== 'string' || event.key.toLowerCase() !== 'm') return;
            if (panel.open || latestActions === null) return;
            event.preventDefault();
            openPanel(latestActions);
          };
          if (typeof ctx.effect === 'function') {
            ctx.effect(() => {
              document.addEventListener('keydown', onShortcut);
              return () => document.removeEventListener('keydown', onShortcut);
            }, 'math-symbols: shortcut');
          } else {
            document.addEventListener('keydown', onShortcut);
          }
        }
      },
    };
  },
});
