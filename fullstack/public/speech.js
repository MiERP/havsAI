'use strict';

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module !== null && module.exports) module.exports = api;
  if (root) root.HavsSpeech = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const DIGITS = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];
  const SCALES = ['', 'nghìn', 'triệu', 'tỷ', 'nghìn tỷ', 'triệu tỷ'];

  const MATH_PATTERN = /(\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$(?!\s)(?:\\.|[^$\\])+?\$)/g;

  const GREEK = {
    alpha: 'anpha', beta: 'bêta', gamma: 'gamma', delta: 'đenta', Delta: 'đenta',
    epsilon: 'êpxilon', varepsilon: 'êpxilon', zeta: 'zêta', eta: 'êta', theta: 'têta',
    Theta: 'têta', iota: 'iôta', kappa: 'kappa', lambda: 'lamđa', Lambda: 'lamđa',
    mu: 'muy', nu: 'nuy', xi: 'xi', pi: 'pi', Pi: 'pi', rho: 'rô', sigma: 'xíchma',
    Sigma: 'xíchma', tau: 'tau', upsilon: 'ýpxilon', phi: 'phi', varphi: 'phi',
    Phi: 'phi', chi: 'khi', psi: 'xibxi', omega: 'ômêga', Omega: 'ômêga'
  };

  const COMMANDS = {
    times: 'nhân', cdot: 'nhân', ast: 'nhân', div: 'chia',
    pm: 'cộng trừ', mp: 'trừ cộng', le: 'nhỏ hơn hoặc bằng', leq: 'nhỏ hơn hoặc bằng',
    leqslant: 'nhỏ hơn hoặc bằng', ge: 'lớn hơn hoặc bằng', geq: 'lớn hơn hoặc bằng',
    geqslant: 'lớn hơn hoặc bằng', ne: 'khác', neq: 'khác', approx: 'xấp xỉ',
    equiv: 'tương đương', sim: 'tỉ lệ với', propto: 'tỉ lệ thuận với',
    infty: 'vô cùng', partial: 'đạo hàm riêng', nabla: 'toán tử nabla',
    to: 'tiến tới', rightarrow: 'tiến tới', longrightarrow: 'tiến tới',
    Rightarrow: 'suy ra', implies: 'suy ra', Leftarrow: 'được suy ra từ',
    leftrightarrow: 'tương đương', Leftrightarrow: 'tương đương',
    rightleftharpoons: 'thuận nghịch', longleftrightarrow: 'tương đương',
    angle: 'góc', perp: 'vuông góc', parallel: 'song song', triangle: 'tam giác',
    sum: 'tổng', prod: 'tích', int: 'tích phân', iint: 'tích phân mặt', oint: 'tích phân đường',
    lim: 'giới hạn', limsup: 'giới hạn trên', liminf: 'giới hạn dưới',
    sin: 'sin', cos: 'côsin', tan: 'tang', cot: 'côtang', sec: 'sec', csc: 'côsec',
    arcsin: 'ác sin', arccos: 'ác côsin', arctan: 'ác tang',
    log: 'lôga', ln: 'lôga tự nhiên', exp: 'ê mũ', det: 'định thức', deg: 'độ',
    circ: 'độ', percent: 'phần trăm', ldots: 'vân vân', dots: 'vân vân', cdots: 'vân vân',
    therefore: 'suy ra', because: 'vì', mid: 'sao cho', forall: 'với mọi',
    exists: 'tồn tại', notin: 'không thuộc', in: 'thuộc', subset: 'tập con',
    subseteq: 'tập con hoặc bằng', cup: 'hợp', cap: 'giao', emptyset: 'tập rỗng'
  };

  const CHEM_STATES = { r: 'rắn', k: 'khí', l: 'lỏng', dd: 'dung dịch', aq: 'dung dịch', s: 'rắn' };

  function tidy(value) {
    return String(value == null ? '' : value)
      .replace(/\s+/g, ' ')
      .replace(/\s+([.,;:!?])/g, '$1')
      .trim();
  }

  function readUnder100(value) {
    const n = Math.trunc(Number(value));
    if (!Number.isFinite(n) || n < 0) return '';
    if (n < 10) return DIGITS[n];
    const tens = Math.floor(n / 10);
    const units = n % 10;
    if (tens === 1) {
      if (!units) return 'mười';
      if (units === 5) return 'mười lăm';
      return 'mười ' + DIGITS[units];
    }
    const head = DIGITS[tens] + ' mươi';
    if (!units) return head;
    if (units === 1) return head + ' mốt';
    if (units === 5) return head + ' lăm';
    return head + ' ' + DIGITS[units];
  }

  function readUnder1000(value, forceHundred) {
    const n = Math.trunc(Number(value));
    const hundreds = Math.floor(n / 100);
    const rest = n % 100;
    if (!hundreds) {
      if (!forceHundred) return readUnder100(rest);
      if (!rest) return 'không trăm';
      if (rest < 10) return 'không trăm linh ' + DIGITS[rest];
      return 'không trăm ' + readUnder100(rest);
    }
    const head = DIGITS[hundreds] + ' trăm';
    if (!rest) return head;
    if (rest < 10) return head + ' linh ' + DIGITS[rest];
    return head + ' ' + readUnder100(rest);
  }

  function readInteger(value) {
    const n = Math.trunc(Math.abs(Number(value)));
    if (!Number.isFinite(n)) return String(value);
    if (!n) return 'không';
    const groups = [];
    let rest = n;
    while (rest > 0) {
      groups.push(rest % 1000);
      rest = Math.floor(rest / 1000);
    }
    const parts = [];
    for (let i = groups.length - 1; i >= 0; i -= 1) {
      const group = groups[i];
      if (!group) continue;
      const hasHigher = i < groups.length - 1;
      const words = readUnder1000(group, hasHigher && group < 100);
      parts.push(SCALES[i] ? words + ' ' + SCALES[i] : words);
    }
    return parts.join(' ');
  }

  function readDigits(value) {
    return String(value)
      .split('')
      .map((digit) => (/[0-9]/.test(digit) ? DIGITS[Number(digit)] : digit))
      .join(' ');
  }

  function readNumber(value) {
    const raw = String(value);
    if (!/[.,]/.test(raw)) return readInteger(raw);
    const parts = raw.split(/[.,]/);
    const head = readInteger(parts[0]);
    const tail = parts.slice(1).map((part) => (part.length <= 2 ? readUnder100(Number(part)) : readDigits(part)));
    return head + ' phẩy ' + tail.join(' ');
  }

  function matchBrace(text, open) {
    let depth = 0;
    for (let i = open; i < text.length; i += 1) {
      if (text[i] === '{') depth += 1;
      else if (text[i] === '}') {
        depth -= 1;
        if (depth === 0) return i;
      }
    }
    return -1;
  }

  function applyCommandArguments(input, names, handler, subject) {
    let out = '';
    let i = 0;
    while (i < input.length) {
      if (input[i] !== '\\') {
        out += input[i];
        i += 1;
        continue;
      }
      const match = /^\\([a-zA-Z]+)/.exec(input.slice(i));
      if (!match || names.indexOf(match[1]) === -1) {
        out += input[i];
        i += 1;
        continue;
      }
      let j = i + match[0].length;
      while (input[j] === ' ') j += 1;
      if (input[j] !== '{') {
        out += input[i];
        i += 1;
        continue;
      }
      const end = matchBrace(input, j);
      if (end < 0) {
        out += input[i];
        i += 1;
        continue;
      }
      out += ' ' + handler(match[1], input.slice(j + 1, end), subject) + ' ';
      i = end + 1;
    }
    return out;
  }

  function replaceFractions(tex, subject) {
    let out = '';
    let i = 0;
    while (i < tex.length) {
      const match = /^\\(?:[dt]?frac)/.exec(tex.slice(i));
      if (!match) {
        out += tex[i];
        i += 1;
        continue;
      }
      let j = i + match[0].length;
      while (tex[j] === ' ') j += 1;
      if (tex[j] !== '{') {
        out += tex[i];
        i += 1;
        continue;
      }
      const numeratorEnd = matchBrace(tex, j);
      if (numeratorEnd < 0) {
        out += tex[i];
        i += 1;
        continue;
      }
      let k = numeratorEnd + 1;
      while (tex[k] === ' ') k += 1;
      if (tex[k] !== '{') {
        out += tex[i];
        i += 1;
        continue;
      }
      const denominatorEnd = matchBrace(tex, k);
      if (denominatorEnd < 0) {
        out += tex[i];
        i += 1;
        continue;
      }
      const numerator = speakMath(tex.slice(j + 1, numeratorEnd), { subject });
      const denominator = speakMath(tex.slice(k + 1, denominatorEnd), { subject });
      out += ' ' + numerator + ' phần ' + denominator + ' ';
      i = denominatorEnd + 1;
    }
    return out;
  }

  function replaceRoots(tex, subject) {
    let out = '';
    let i = 0;
    while (i < tex.length) {
      const match = /^\\sqrt\b/.exec(tex.slice(i));
      if (!match) {
        out += tex[i];
        i += 1;
        continue;
      }
      let j = i + match[0].length;
      while (tex[j] === ' ') j += 1;
      let degree = '';
      if (tex[j] === '[') {
        const close = tex.indexOf(']', j);
        if (close > j) {
          degree = tex.slice(j + 1, close);
          j = close + 1;
        }
      }
      while (tex[j] === ' ') j += 1;
      if (tex[j] !== '{') {
        out += ' căn bậc hai của ';
        i = j;
        continue;
      }
      const end = matchBrace(tex, j);
      if (end < 0) {
        out += tex[i];
        i += 1;
        continue;
      }
      const radicand = speakMath(tex.slice(j + 1, end), { subject });
      const prefix = degree ? 'căn bậc ' + speakMath(degree, { subject }) + ' của ' : 'căn bậc hai của ';
      out += ' ' + prefix + radicand + ' ';
      i = end + 1;
    }
    return out;
  }

  function replaceScripts(tex, subject) {
    const withSuperscripts = tex.replace(
      /\^\s*(\{[^{}]*\}|[A-Za-z0-9+\-.]|\\[a-zA-Z]+)/g,
      (match, body) => {
        const inner = tidy(body.startsWith('{') ? body.slice(1, -1) : body);
        if (!inner) return ' ';
        if (/^2$/.test(inner)) return ' bình phương ';
        if (/^3$/.test(inner)) return ' lập phương ';
        if (/^(\\circ|circ|o|0)$/.test(inner)) return ' độ ';
        if (/^(\\prime|')$/.test(inner)) return ' phẩy ';
        return ' mũ ' + speakMath(inner, { subject }) + ' ';
      }
    );

    return withSuperscripts.replace(
      /_\s*(\{[^{}]*\}|[A-Za-z0-9+\-.]|\\[a-zA-Z]+)/g,
      (match, body) => {
        const inner = tidy(body.startsWith('{') ? body.slice(1, -1) : body);
        if (!inner) return ' ';
        if (/^\d+$/.test(inner)) return ' ' + readDigits(inner) + ' ';
        return ' chỉ số ' + speakMath(inner, { subject }) + ' ';
      }
    );
  }

  function commandWord(name, subject) {
    if (name === 'to' || name === 'rightarrow' || name === 'longrightarrow') {
      return subject === 'chemistry' || subject === 'biology' ? 'tạo thành' : 'tiến tới';
    }
    if (COMMANDS[name]) return COMMANDS[name];
    if (GREEK[name]) return GREEK[name];
    return '';
  }

  function speakChemistry(input, subject) {
    let text = String(input || '');
    text = text.replace(/<=>|<->|⇌|⇄/g, ' thuận nghịch ');
    text = text.replace(/->|→/g, ' tạo thành ');
    text = text.replace(/\((r|k|l|dd|aq|s)\)/gi, (match, state) => {
      const word = CHEM_STATES[String(state).toLowerCase()];
      return word ? ' ' + word + ' ' : ' ';
    });
    text = text.replace(/([A-Z][a-z]?)(\d*)/g, (match, element, count) => element + (count ? ' ' + readDigits(count) : '') + ' ');
    text = text.replace(/\+/g, ' cộng ');
    return tidy(text);
  }

  function speakMath(raw, options) {
    const opts = options || {};
    const subject = String(opts.subject || 'math').toLowerCase();
    let tex = String(raw == null ? '' : raw).trim();

    tex = tex
      .replace(/^\$\$([\s\S]*)\$\$$/, '$1')
      .replace(/^\\\[([\s\S]*)\\\]$/, '$1')
      .replace(/^\\\(([\s\S]*)\\\)$/, '$1')
      .replace(/^\$([\s\S]*)\$$/, '$1');

    tex = tex.replace(/\\begin\{[^}]*\}|\\end\{[^}]*\}/g, ' ');
    tex = tex.replace(/\\(?:left|right|big|Big|bigg|Bigg)(?![a-zA-Z])\s*/g, '');
    tex = tex.replace(/\\[,;:! ]/g, ' ').replace(/\\qquad\b|\\quad\b/g, ' ');
    tex = tex.replace(/\\\\/g, ' ').replace(/&/g, ' ');

    tex = applyCommandArguments(tex, ['text', 'textrm', 'textnormal', 'mathrm', 'operatorname', 'mathit', 'mathbf', 'mathsf'], (name, arg, scope) => speakMath(arg, { subject: scope }), subject);
    tex = applyCommandArguments(tex, ['ce', 'ch'], (name, arg, scope) => speakChemistry(arg, scope), subject);

    tex = replaceFractions(tex, subject);
    tex = replaceRoots(tex, subject);
    tex = replaceScripts(tex, subject);

    tex = applyCommandArguments(tex, ['vec', 'overrightarrow'], (name, arg, scope) => 'vectơ ' + speakMath(arg, { subject: scope }), subject);
    tex = applyCommandArguments(tex, ['overline', 'bar', 'hat', 'widehat', 'tilde'], (name, arg, scope) => speakMath(arg, { subject: scope }), subject);

    tex = tex.replace(/\\%/g, ' phần trăm ');
    tex = tex.replace(/\\([a-zA-Z]+)/g, (match, name) => ' ' + commandWord(name, subject) + ' ');

    tex = tex.replace(/[{}]/g, ' ').replace(/[()[\]]/g, ' ');
    tex = tex.replace(/\|/g, ' ');
    tex = tex.replace(/'/g, ' phẩy ');
    tex = tex.replace(/\+/g, ' cộng ');
    tex = tex.replace(/-/g, ' trừ ');
    tex = tex.replace(/=/g, ' bằng ');
    tex = tex.replace(/</g, ' nhỏ hơn ');
    tex = tex.replace(/>/g, ' lớn hơn ');
    tex = tex.replace(/\*/g, ' nhân ');
    tex = tex.replace(/\//g, ' phần ');
    tex = tex.replace(/\d+(?:[.,]\d+)?/g, (match) => ' ' + readNumber(match) + ' ');

    return tidy(tex);
  }

  const UNIT_RULES = [
    [/km\/h/gi, 'ki lô mét trên giờ'],
    [/m\/s²|m\/s2/gi, 'mét trên giây bình phương'],
    [/km\/s/gi, 'ki lô mét trên giây'],
    [/m\/s/gi, 'mét trên giây'],
    [/kg\/m³|kg\/m3/gi, 'ki lô gam trên mét khối'],
    [/g\/mol/gi, 'gam trên mol'],
    [/mg\/l/gi, 'mi li gam trên lít'],
    [/mol\/l/gi, 'mol trên lít'],
    [/g\/ml/gi, 'gam trên mi li lít'],
    [/n\/m²|n\/m2/gi, 'niu tơn trên mét vuông'],
    [/v\/m\b/gi, 'vôn trên mét'],
    [/j\/kg/gi, 'jun trên ki lô gam'],
    [/w\/m²|w\/m2/gi, 'oát trên mét vuông'],
    [/cm³/gi, 'xăng ti mét khối'],
    [/cm²/gi, 'xăng ti mét vuông'],
    [/dm³/gi, 'đề xi mét khối'],
    [/m³/gi, 'mét khối'],
    [/m²/gi, 'mét vuông'],
    [/\bcm\b/gi, 'xăng ti mét'],
    [/\bkm\b/gi, 'ki lô mét'],
    [/\bkg\b/gi, 'ki lô gam'],
    [/\bmg\b/gi, 'mi li gam'],
    [/\bml\b/gi, 'mi li lít'],
    [/\bmol\b/gi, 'mol']
  ];

  const PROSE_SYMBOLS = [
    [/%/g, ' phần trăm '],
    [/°\s*C\b/g, ' độ C '],
    [/°\s*F\b/g, ' độ F '],
    [/°/g, ' độ '],
    [/×/g, ' nhân '],
    [/÷/g, ' chia '],
    [/·/g, ' nhân '],
    [/−/g, ' trừ '],
    [/≈/g, ' xấp xỉ '],
    [/≠/g, ' khác '],
    [/≤/g, ' nhỏ hơn hoặc bằng '],
    [/≥/g, ' lớn hơn hoặc bằng '],
    [/±/g, ' cộng trừ '],
    [/√/g, ' căn bậc hai của '],
    [/∞/g, ' vô cùng '],
    [/π/g, ' pi '],
    [/∆/g, ' đenta '],
    [/μ/g, ' muy '],
    [/Ω/g, ' ôm '],
    [/α/g, ' anpha '],
    [/β/g, ' bêta '],
    [/γ/g, ' gamma '],
    [/δ/g, ' đenta '],
    [/θ/g, ' têta '],
    [/λ/g, ' lamđa '],
    [/ρ/g, ' rô '],
    [/σ/g, ' xíchma '],
    [/τ/g, ' tau '],
    [/φ/g, ' phi '],
    [/ω/g, ' ômêga ']
  ];

  function verbalizeProse(input, subject) {
    let text = String(input || '');

    text = text.replace(/\b(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{2,4})\b/g, 'ngày $1 tháng $2 năm $3');

    for (let i = 0; i < UNIT_RULES.length; i += 1) {
      text = text.replace(UNIT_RULES[i][0], UNIT_RULES[i][1]);
    }

    text = text.replace(/\b(\d+)\s*\/\s*(\d+)\b/g, '$1 phần $2');

    for (let i = 0; i < PROSE_SYMBOLS.length; i += 1) {
      text = text.replace(PROSE_SYMBOLS[i][0], PROSE_SYMBOLS[i][1]);
    }

    if (subject === 'chemistry' || subject === 'biology') {
      text = text.replace(/<=>|<->|⇌|⇄/g, ' thuận nghịch ');
      text = text.replace(/->|→/g, ' tạo thành ');
      text = text.replace(/\b((?:[A-Z][a-z]?\d*)+)\b/g, (match) => {
        if (!/\d/.test(match)) return match;
        return match.replace(/([A-Z][a-z]?)(\d*)/g, (all, element, count) => element + (count ? ' ' + readDigits(count) : '') + ' ');
      });
      if (subject === 'biology') {
        text = text.replace(/\b([ATUXG])\s*[-–—]\s*([ATUXG])\b/g, '$1 liên kết $2');
      }
    } else {
      text = text.replace(/=>|⇒/g, ' suy ra ');
      text = text.replace(/->|→/g, ' tiến tới ');
      text = text.replace(/(\d)\s*<\s*(\d)/g, '$1 nhỏ hơn $2');
      text = text.replace(/(\d)\s*>\s*(\d)/g, '$1 lớn hơn $2');
    }

    return text;
  }

  const PAUSE = {
    sentence: 420,
    colon: 340,
    semicolon: 280,
    comma: 200,
    break: 180
  };

  function splitForSpeech(input, options) {
    const opts = options || {};
    const maxLen = opts.maxLen || 165;
    const minLen = opts.minLen || 24;
    const text = tidy(input);
    if (!text) return [];

    const segments = [];
    let buffer = '';
    let pause = PAUSE.break;

    const push = (value, gap) => {
      const trimmed = tidy(value);
      if (trimmed) segments.push({ text: trimmed, pause: gap });
    };

    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      const previous = text[i - 1] || '';
      const next = text[i + 1] || '';
      const betweenDigits = /\d/.test(previous) && /\d/.test(next);
      buffer += char;

      let boundary = 0;
      if (char === '.' || char === '!' || char === '?' || char === '…') {
        if (!betweenDigits && (next === '' || next === ' ')) boundary = PAUSE.sentence;
      } else if (char === ':') {
        if (!betweenDigits) boundary = PAUSE.colon;
      } else if (char === ';') {
        boundary = PAUSE.semicolon;
      } else if (char === ',') {
        if (!betweenDigits) boundary = PAUSE.comma;
      }

      if (boundary) {
        push(buffer, boundary);
        buffer = '';
        pause = boundary;
        continue;
      }

      if (buffer.length >= maxLen) {
        const space = buffer.lastIndexOf(' ');
        if (space > 0) {
          push(buffer.slice(0, space), PAUSE.comma);
          buffer = buffer.slice(space + 1);
        } else {
          push(buffer, PAUSE.comma);
          buffer = '';
        }
      }
    }

    push(buffer, pause);

    const merged = [];
    for (const segment of segments) {
      const last = merged[merged.length - 1];
      if (last) {
        const lastIsFragment = last.text.length < 4
          || (!/[.!?…]$/.test(last.text) && last.text.length < minLen);
        const nextIsFragment = segment.text.length < 4;
        if ((lastIsFragment || nextIsFragment) && last.text.length + segment.text.length + 1 <= maxLen) {
          last.text = last.text + ' ' + segment.text;
          last.pause = Math.max(last.pause, segment.pause);
          continue;
        }
      }
      merged.push({ text: segment.text, pause: segment.pause });
    }
    return merged;
  }

  function verbalize(input, options) {
    const opts = options || {};
    const subject = String(opts.subject || 'math').toLowerCase();
    let text = String(input == null ? '' : input);
    if (!text.trim()) return '';

    text = text.replace(/```[\s\S]*?```/g, ' ');
    text = text.replace(MATH_PATTERN, (match) => ' ' + speakMath(match, { subject }) + ' ');
    text = text.replace(/\\[a-zA-Z]+(?:\s*\{[^{}]*\})*/g, (match) => ' ' + speakMath(match, { subject }) + ' ');
    text = text.replace(/[A-Za-z0-9)]\s*\^\s*(?:\{[^{}]*\}|\d+)/g, (match) => ' ' + speakMath(match, { subject }) + ' ');

    text = text
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/^>\s*/gm, ' ')
      .replace(/^\s*[-*+]\s+/gm, ' ')
      .replace(/[*_#`~|]/g, ' ')
      .replace(/\s+/g, ' ');

    if (subject !== 'english') text = verbalizeProse(text, subject);

    return tidy(text);
  }

  return {
    verbalize: verbalize,
    verbalizeProse: verbalizeProse,
    splitForSpeech: splitForSpeech,
    speakMath: speakMath,
    speakChemistry: speakChemistry,
    readNumber: readNumber,
    readInteger: readInteger
  };
});
