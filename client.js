window.__ModuleLoader__.load({
  id: 'dsh-mathpad',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    // 与 package.json 的 version 保持一致：面板底部会显示它，用来确认页面里跑的是哪一版。
    const VERSION = '0.1.0';

    // ---------------------------------------------------------------------
    // 面板里的符号：点一下把 text 插到草稿光标处。
    // 只保留真正会用的：基本初等函数、幂与根、积分极限、四则运算。
    // 关系符、希腊字母、偏导这类用不到的就不放了（需要就直接在草稿里打）。
    // ---------------------------------------------------------------------
    const GROUPS = [
      {
        name: '基本初等函数',
        items: [
          ['sin', 'sin', '正弦 sin'],
          ['cos', 'cos', '余弦 cos'],
          ['tan', 'tan', '正切 tan'],
          ['cot', 'cot', '余切 cot'],
          ['sec', 'sec', '正割 sec'],
          ['csc', 'csc', '余割 csc'],
          ['arcsin', 'arcsin', '反正弦'],
          ['arccos', 'arccos', '反余弦'],
          ['arctan', 'arctan', '反正切'],
          ['eˣ', 'e', '指数 exp'],
          ['ln', 'ln', '对数 log'],
          ['xⁿ', 'x', 'x 的幂'],
        ],
      },
      {
        name: '幂与根',
        items: [
          ['x²', 'x2', '平方'],
          ['x³', 'x3', '立方'],
          ['√', '√', '根号 sqrt'],
          ['(', '(', '左括号'],
          [')', ')', '右括号'],
          ['空格', ' ', '次方 分隔'],
        ],
      },
      {
        name: '积分与极限',
        items: [
          ['∫', '∫', '积分 integral'],
          ['∮', '∮', '环路积分 闭合曲线 contour'],
          ['∂', '∂', '偏导 partial'],
          ['d', 'd', '微分 dx'],
          ['lim', 'lim', '极限 limit'],
          ['→', '→', '趋于 tends to'],
          ['π', 'π', '圆周率 pi'],
          ['∞', '∞', '无穷 infinity'],
        ],
      },
      {
        name: '运算',
        items: [
          ['+', '+', '加'],
          ['−', '-', '减'],
          ['×', '*', '乘'],
          ['÷', '/', '除'],
          ['=', '=', '等于'],
          ['.', '.', '小数点'],
        ],
      },
    ];

    const ALL_ITEMS = [];
    for (const group of GROUPS) {
      for (const item of group.items) {
        ALL_ITEMS.push({ glyph: item[0], text: item[1], keys: item[2] ?? '', group: group.name });
      }
    }

    const FUNCS = ['arcsin', 'arccos', 'arctan', 'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'ln'];
    const SUPERSCRIPTS = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };

    /**
     * 把草稿按我们的约定翻译成人话，用来给用户确认：
     *   sin3x → sin(3x)    （无空格 = 倍数）
     *   sin3 x → sin³(x)   （有空格 = 次方）
     *   e3 → e³ ／ x5 → x⁵ （e、x 后面的数字 = 指数）
     * 只做展示，插入的始终是草稿原文。
     */
    const explain = (raw) => {
      let out = raw;
      for (const fn of FUNCS) {
        const escaped = fn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        out = out.replace(new RegExp(escaped + '([0-9]+) +([a-zA-Z])', 'g'), (match, power, arg) => fn + '^' + power + '(' + arg + ')');
        out = out.replace(new RegExp(escaped + '([0-9]+)([a-zA-Z(])', 'g'), (match, multiple, arg) => fn + '(' + multiple + arg + ')');
        out = out.replace(new RegExp(escaped + '([a-zA-Z])', 'g'), (match, arg) => fn + '(' + arg + ')');
      }
      out = out.replace(/(^|[^a-zA-Z])e([0-9]+)/g, (match, prefix, power) => prefix + 'e^' + power);
      out = out.replace(/ex(?![a-zA-Z])/g, 'e^x');
      out = out.replace(/(^|[^a-zA-Z])x([0-9]+)/g, (match, prefix, power) => prefix + 'x^' + power);
      return out.replace(/\^([0-9])/g, (match, digit) => SUPERSCRIPTS[digit] ?? match);
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
      chain: [],
    };
    // 草稿里最后的光标位置：点击符号时插在这里，而不是总插到末尾。
    let caretPosition = null;
    const listeners = new Set();
    const emit = () => { for (const listener of listeners) listener(); };
    const patchPanel = (patch) => { Object.assign(panel, patch); emit(); };

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
      // 函数名：长名优先；后面紧跟字母/数字时补一个空格（\sin x 而不是 \sinx）
      out = out.replace(/(?<!\\)(arcsin|arccos|arctan|sin|cos|tan|cot|sec|csc|ln|lim)/g,
        (match, _name, offset, whole) => {
          const next = whole[offset + match.length] ?? '';
          return '\\' + match + (/[a-zA-Z0-9]/.test(next) ? ' ' : '');
        });
      const symbols = [
        ['∫', '\\int'], ['∮', '\\oint'], ['∂', '\\partial'], ['π', '\\pi'], ['∞', '\\infty'],
        ['→', '\\to'], ['√', '\\sqrt'], ['×', '\\times'], ['÷', '\\div'], ['≤', '\\le'],
        ['≥', '\\ge'], ['≠', '\\ne'], ['≈', '\\approx'], ['±', '\\pm'], ['∑', '\\sum'],
        ['(', '('], [')', ')'],
      ];
      for (const [from, to] of symbols) out = out.split(from).join(to);
      // lim 后面跟着含“→”的一段时才收进下标，避免把普通参数误当下标
      out = out.replace(/\\lim\s*([^\s$]*\\to[^\s$]*)/g, (match, sub) => '\\lim_{' + sub.replace(/\\to/g, ' \\to ') + '}');
      // √ 后面紧跟的一段收进花括号
      out = out.replace(/\\sqrt([^\s$]+)/g, (match, body) => '\\sqrt{' + body + '}');
      return out;
    };

    const openPanel = (actions) => {
      if (actions === undefined || actions === null) return;
      let span = null;
      try { span = actions.captureInsertion(); } catch { span = null; }
      patchPanel({ open: true, actions, span, text: '', direct: readDirectMode(), latex: readLatexMode(), chain: [] });
      caretPosition = null;
    };
    const closePanel = () => {
      patchPanel({ open: false, actions: null, span: null, text: '', chain: [] });
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
      if (text === '') { closePanel(); return; }
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
        for (let k = 0; k < 1; k += 1) {
          const kMid = kappaAt(s + h / 2);
          const thMid = theta + kMid * h / 2;
          x += Math.cos(thMid) * h;
          y += Math.sin(thMid) * h;
          theta += kappaAt(s + h) * h;
          s += h;
        }
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
      .mss-trigger:focus-visible .mss-frame-line{stroke:var(--dsw-alias-state-business-primary, #4176e6);opacity:1}
      .mss-trigger:focus-visible .mss-frame-fill{opacity:.06}
      /* ∑ 的墨迹天然偏下：line-height:0 让行内盒贴住盒子中心，再用墨迹中心差把它挪正 */
      .mss-trigger .mss-sigma{position:relative;z-index:1;display:block;font-size:12px;line-height:0;
        transform:translateY(var(--mss-ink-center, -2.1px))}
      .mss-scrim{position:fixed;inset:0;z-index:600;background:rgba(15,17,21,.28);display:grid;place-items:center;padding:24px}
      .mss-dialog{width:660px;max-width:calc(100vw - 48px);max-height:calc(100vh - 64px);display:flex;flex-direction:column;
        background:var(--dsw-alias-bg-base, #fff);color:inherit;border:1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08));
        border-radius:16px;box-shadow:0 24px 64px rgba(15,17,21,.24),0 2px 8px rgba(15,17,21,.08);overflow:hidden}
      .mss-head{display:flex;align-items:flex-start;gap:10px;padding:18px 20px 10px}
      .mss-head h2{margin:0;font-size:16px;font-weight:600}
      .mss-head p{margin:3px 0 0;font-size:12px;opacity:.6}
      .mss-close{margin-left:auto;width:28px;height:28px;border:none;background:transparent;color:inherit;opacity:.5;
        font-size:17px;line-height:1;border-radius:8px;cursor:pointer}
      .mss-close:hover{opacity:.9;background:var(--dsw-alias-interactive-bg-hover, rgba(38,49,72,.06))}
      .mss-mode{font:inherit;font-size:12px;padding:4px 10px;border-radius:999px;cursor:pointer;
        border:1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.14));background:transparent;color:inherit;opacity:.75}
      .mss-mode:hover{opacity:1;background:var(--dsw-alias-interactive-bg-hover, rgba(38,49,72,.06))}
      .mss-mode-on{background:var(--dsw-alias-state-business-primary, #4176e6);border-color:transparent;color:#fff;opacity:1}
      .mss-drafttext{flex:1;min-width:0;font-family:"Cambria Math",Consolas,monospace;font-size:15px;opacity:.85;
        white-space:pre-wrap;word-break:break-all}
      .mss-search-wrap{padding:0 20px}
      .mss-search{width:100%;height:36px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.12));
        background:var(--dsw-alias-bg-module-platform, rgba(128,128,128,.05));color:inherit;padding:0 12px;
        font:inherit;font-size:13px;outline:none;box-sizing:border-box}
      .mss-search::placeholder{opacity:.45}
      .mss-search:focus{border-color:var(--dsw-alias-state-business-primary, #4176e6)}
      .mss-body{padding:12px 20px 0;overflow:auto;flex:1;min-height:100px}
      .mss-sect{display:flex;align-items:flex-start;gap:10px;padding:6px 0}
      .mss-sect + .mss-sect{border-top:1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08))}
      .mss-sname{width:84px;flex:none;font-size:11.5px;opacity:.55;padding-top:9px;line-height:1.4}
      .mss-cells{display:grid;grid-template-columns:repeat(6, minmax(0, 1fr));gap:7px;flex:1;min-width:0}
      .mss-cell{border:1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.1));border-radius:9px;background:transparent;
        color:inherit;padding:7px 4px 6px;text-align:center;cursor:pointer;font:inherit}
      .mss-cell:hover{border-color:var(--dsw-alias-state-business-primary, #4176e6);background:var(--dsw-alias-interactive-bg-hover, rgba(38,49,72,.06))}
      .mss-glyph{font-family:"Cambria Math","Segoe UI",serif;font-size:15px;line-height:1.25}
      .mss-code{font-size:10px;opacity:.55;margin-top:1px;font-family:Consolas,"SF Mono",monospace}
      .mss-keypad{display:flex;gap:6px;padding:2px 20px 10px;flex-wrap:wrap}
      .mss-key{min-width:32px;height:30px;padding:0 9px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.14));
        background:transparent;color:inherit;font:inherit;font-size:13px;cursor:pointer}
      .mss-key:hover{background:var(--dsw-alias-interactive-bg-hover, rgba(38,49,72,.06))}
      .mss-key-space{color:inherit;opacity:.75;font-size:12px}
      .mss-key-clear{margin-left:auto;opacity:.75}
      .mss-draft{margin:0 20px;border-top:1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08));padding-top:12px}
      .mss-draftrow{display:flex;align-items:center;gap:10px;min-height:44px;padding:8px 10px;border-radius:10px;
        border:1px solid var(--dsw-alias-state-business-primary, #4176e6);
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
      .mss-btn:hover{opacity:1;background:var(--dsw-alias-interactive-bg-hover, rgba(38,49,72,.06))}
      .mss-btn-primary{background:var(--dsw-alias-state-business-primary, #4176e6);border-color:transparent;color:#fff;opacity:1;font-weight:500}
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
    function MathSymbolsTrigger(props) {
      const actions = props === null || props === undefined ? undefined : props.inputActions;
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

      const insertSnippet = (snippet) => {
        if (state.direct) { insertDirect(snippet); return; }
        const start = caret();
        const end = caretEnd();
        putText(state.text.slice(0, start) + snippet + state.text.slice(end), start + snippet.length);
      };

      const backspace = () => {
        const start = caret();
        const end = caretEnd();
        if (start === end) {
          if (start === 0) return;
          putText(state.text.slice(0, start - 1) + state.text.slice(end), start - 1);
          return;
        }
        putText(state.text.slice(0, start) + state.text.slice(end), start);
      };

      const scrim = (event) => {
        if (event.target === event.currentTarget) closePanel();
      };

      const sourceText = state.direct ? state.chain.join('') : state.text;
      const reading = state.latex ? toLatex(sourceText) : explain(sourceText);
      const sections = GROUPS.map((group) => ({
        name: group.name,
        items: group.items.map((item) => ({ glyph: item[0], text: item[1] })),
      }));

      const onKeyDown = (event) => {
        if (event.key === 'Escape') { event.stopPropagation(); closePanel(); return; }
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          if (state.direct) { closePanel(); return; }
          insertDraft();
        }
        if (event.key === 'Backspace' && event.metaKey) { event.preventDefault(); putText('', 0); }
      };

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
              h('button', {
                type: 'button',
                className: 'mss-mode',
                title: state.direct ? '切回草稿模式' : '切成直插模式',
                onClick: () => setDirectMode(!state.direct),
              }, state.direct ? '⇢ 直插' : '⌨ 草稿'),
              h('button', {
                type: 'button',
                className: 'mss-mode' + (state.latex ? ' mss-mode-on' : ''),
                title: '插入时把草稿转成 LaTeX',
                onClick: () => setLatexMode(!state.latex),
              }, state.latex ? 'TeX ✓' : 'TeX'),
              h('button', { type: 'button', className: 'mss-close', 'aria-label': '关闭', onClick: closePanel }, '×'),
            ),
            h('div', { className: 'mss-body' },
              sections.map((section) => h('div', { key: section.name, className: 'mss-sect' },
                h('div', { className: 'mss-sname' }, section.name),
                h('div', { className: 'mss-cells' },
                  section.items.map((item) => h('button', {
                    key: item.glyph + item.text,
                    type: 'button',
                    className: 'mss-cell',
                    title: '插入 ' + item.text,
                    onMouseDown: keepFocus,
                    onClick: () => insertSnippet(item.text),
                  },
                    h('div', { className: 'mss-glyph' }, item.glyph),
                    h('div', { className: 'mss-code' }, item.text === ' ' ? '空格' : item.text),
                  )),
                ),
              )),
            ),
            h('div', { className: 'mss-keypad' },
              ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'].map((digit) => h('button', {
                key: digit,
                type: 'button',
                className: 'mss-key',
                onMouseDown: keepFocus,
                onClick: () => insertSnippet(digit),
              }, digit)),
              h('button', {
                type: 'button',
                className: 'mss-key mss-key-space',
                title: '空格 + 次数 = 次方：sin3 x 就是 sin³x',
                onMouseDown: keepFocus,
                onClick: () => insertSnippet(' '),
              }, '空格（次方）'),
              state.direct
                ? null
                : h('button', {
                  type: 'button',
                  className: 'mss-key mss-key-clear',
                  onMouseDown: keepFocus,
                  onClick: backspace,
                }, '⌫ 删除'),
            ),
            h('div', { className: 'mss-draft' },
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
                    onKeyDown,
                    onKeyUp: (event) => { caretPosition = event.currentTarget.selectionStart; },
                    onClick: (event) => { caretPosition = event.currentTarget.selectionStart; },
                    onSelect: (event) => { caretPosition = event.currentTarget.selectionStart; },
                    onChange: (event) => {
                      caretPosition = event.target.selectionStart;
                      patchPanel({ text: event.target.value });
                    },
                  }),
              ),
              h('div', { className: 'mss-preview' },
                h('span', { className: 'mss-lbl' }, state.latex ? 'LaTeX' : '读作'),
                reading === ''
                  ? h('span', { className: 'mss-note' }, state.direct ? '还没点任何符号' : '还没有内容')
                  : h('span', { className: 'mss-math' }, reading),
                h('span', { className: 'mss-note' }, state.latex
                  ? '· 插入时用这段 LaTeX'
                  : '· sin3x → sin(3x)　· sin3 x → sin³x　· e3 → e³'),
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

        ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
          name: 'conversation.input.right',
          id: 'math-symbols',
          order: 35,
        }, MathSymbolsTrigger));

        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'math-symbols-panel',
        }, MathSymbolsDialog));
      },
    };
  },
});
