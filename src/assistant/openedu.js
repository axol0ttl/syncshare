import { candidate } from './fields';

// «ORG+COURSE+RUN» из адреса вида .../course-v1:ORG+COURSE+RUN/... или .../block-v1:ORG+COURSE+RUN+type@...
function courseKey(url) {
  let u = String(url || '');
  try { u = decodeURIComponent(u); } catch (e) { /* как есть */ }
  const m = u.match(/(?:course|block)-v1:([^+\/?#\s]+)\+([^+\/?#\s]+)\+([^+\/?#\s]+)/);
  return m ? `${m[1]}+${m[2]}+${m[3]}` : null;
}
// латиница, похожая на кириллицу (после toLowerCase), — сводим к кириллице с обеих сторон
const HOMO = { a: 'а', b: 'в', c: 'с', e: 'е', h: 'н', k: 'к', m: 'м', o: 'о', p: 'р', t: 'т', x: 'х', y: 'у' };

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[abcehkmoptxy]/g, (ch) => HOMO[ch])
    .replace(/[^0-9a-zа-я]+/g, ' ')
    .trim();
}

function grams(s) {
  const t = ` ${s} `;
  const g = new Set();
  for (let i = 0; i < t.length - 2; i++) g.add(t.substr(i, 3));
  return g;
}
function inter(A, B) {
  const [s, l] = A.size < B.size ? [A, B] : [B, A];
  let n = 0;
  for (const x of s) if (l.has(x)) n++;
  return n;
}
const dice = (A, B) => (A.size && B.size ? (2 * inter(A, B)) / (A.size + B.size) : 0);
const cover = (A, B) => (A.size ? inter(A, B) / A.size : 0); // какая доля A есть в B
const avg = values => values.reduce((sum, n) => sum + n, 0) / values.length;
const stripEnum = (s) => String(s || '').replace(/^\s*(?:[a-zа-я]|\d{1,2})[).]\s+/i, '');
const cssEsc = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\\]\[]/g, '\\$&'));

const BLOCKS = 'p,div,li,br,td,th,tr,h1,h2,h3,h4,h5,h6,label,legend,ul,ol,table,section';
const JUNK = 'script,style,noscript,.sr,.sr-only,.visually-hidden,.status,.indicator-container,' +
  '.notification,.pv-badge,button,input,select,textarea';

// текст элемента с пробелами (или переводами строк) между блоками
function textOf(el, sep = ' ') {
  if (!el) return '';
  const c = el.cloneNode(true);
  c.querySelectorAll(JUNK).forEach((x) => x.remove());
  c.querySelectorAll(BLOCKS).forEach((x) => x.after(sep));
  const t = c.textContent.replace(/ /g, ' ');
  return sep === '\n'
    ? t.replace(/[ \t\r\f\v]+/g, ' ').replace(/ *\n\s*/g, '\n').trim()
    : t.replace(/\s+/g, ' ').trim();
}
// Таблица «ВОПРОС | ОТВЕТ» → [[вопрос, ответ], ...]
function parsePolyvsp(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const rows = [];
  for (const tr of doc.querySelectorAll('table tr')) {
    const cells = [...tr.children]
      .filter((c) => c.tagName === 'TD' || c.tagName === 'TH')
      .map((c) => textOf(c, '\n'));
    while (cells.length > 2 && /^\s*\d*\s*$/.test(cells[0])) cells.shift(); // колонка «№»
    if (cells.length < 2) continue;
    const q = cells[0];
    const a = cells.slice(1).filter(Boolean).join('\n');
    if (!q || !a) continue;
    if (/^вопрос/i.test(q) && /^ответ/i.test(a)) continue; // заголовок таблицы
    rows.push([q, a]);
  }
  if (rows.length >= 3) return rows;

  // запасной вариант: записи вида «вопрос … Ответ: …» в абзацах и списках
  const scope = doc.querySelector('.entry-content, article, main, #content') || doc.body;
  for (const el of scope.querySelectorAll('li, p')) {
    const m = textOf(el, '\n').match(/^([\s\S]{8,}?)\s*(?:правильный\s+)?ответ\s*[:\-–—]\s*([\s\S]+)$/i);
    if (m) rows.push([m[1].trim(), m[2].trim()]);
  }
  return rows;
}

function cleanAnswer(a) {
  let t = String(a).replace(/ /g, ' ').trim();
  const unknown = /не\s*знаем\s*ответ|ответ\s+неизвест/i.test(t);
  const whole = /^\(?\s*(не\s*)?верно\s*\)?[.;!]*$/i.test(t); // ответ целиком «верно»/«неверно»
  const doubt = !whole && /(^|[^а-яё])(неверно|не\s+верно|не\s+точно|под\s+вопросом)([^а-яё]|$)/i.test(t);
  if (!whole) t = t.replace(/(?<![а-яё])\(?\s*верно\s*\)?[\s.;!]*$/i, ''); // хвостовая пометка «верно»
  t = t.replace(/[\s;,]+$/, '').trim();
  return { text: t, unknown, doubt };
}
const recGrams = (r) => r.g || (r.g = grams(r.nq));

// похожесть вопроса со страницы (несколько вариантов текста) на вопрос из базы
function qScore(cands, r) {
  const rg = recGrams(r);
  let best = 0;
  for (const cg of cands) {
    const n = inter(cg, rg);
    let s = (2 * n) / (cg.size + rg.size);
    if (rg.size >= 30) s = Math.max(s, (0.9 * n) / rg.size); // вопрос из базы целиком внутри текста страницы
    if (cg.size >= 40) s = Math.max(s, (0.9 * n) / cg.size); // текст страницы целиком внутри вопроса из базы
    if (s > best) best = s;
  }
  return best;
}

function answerChunks(raw) {
  const set = new Set();
  for (const part of String(raw).split(/[;\n]+/)) {
    const n = norm(part);
    if (n) set.add(n);
    if (part.includes(',')) for (const p of part.split(',')) { const m = norm(p); if (m) set.add(m); }
  }
  return [...set];
}

// насколько вариант ответа на странице совпадает с ответом из базы
function optScore(optN, ansN, chunks) {
  if (!optN) return { s: 0, raw: 0 };
  if (chunks.includes(optN)) return { s: 1, raw: 1, how: 'exact' };
  if (optN.length <= 2) return { s: 0, raw: 0 }; // «а», «1» и т.п. — только точное совпадение
  const hay = ` ${ansN} `;
  const at = hay.indexOf(` ${optN} `);
  if (at >= 0) return { s: optN.length >= 5 ? 0.95 : 0.85, raw: 1, how: 'sub', span: [at, at + optN.length + 1] };
  const og = grams(optN);
  let raw = 0, chunk = null;
  for (const c of chunks) { const d = dice(og, grams(c)); if (d > raw) { raw = d; chunk = c; } }
  let s = raw >= 0.9 ? raw * 0.9 : raw * 0.7;
  if (optN.length >= 25) {
    const cv = cover(og, grams(ansN));
    if (cv >= 0.92 && cv * 0.85 > s) { s = cv * 0.85; raw = Math.max(raw, cv); chunk = null; }
  }
  return { s, raw, how: 'fuzzy', chunk };
}

const ALL_RE = /^вс[её]( \d+)?( вариант| ответ| перечисл| утвержд| пункт)/;

// ответ номерами вариантов в конце записи: «1 3 4 5», «(12)», «134» → индексы с нуля
function digitPicks(ansN, n) {
  if (n < 2 || n > 9) return null;
  const toks = ansN.split(' ');
  let run = [];
  for (let i = toks.length - 1; i >= 0 && /^\d+$/.test(toks[i]); i--) run.unshift(toks[i]); // в конце
  if (!run.length) for (let i = 0; i < toks.length && /^\d+$/.test(toks[i]); i++) run.push(toks[i]); // или в начале
  if (!run.length) return null;
  let nums;
  if (run.length === 1) nums = run[0].split('').map(Number);
  else if (run.every((t) => t.length === 1)) nums = run.map(Number);
  else return null;
  if (nums.some((x) => x < 1 || x > n) || new Set(nums).size !== nums.length) return null;
  return nums.map((x) => x - 1).sort((a, b) => a - b);
}
const isNumericOpts = (u) => u.options.some((o) => /^\d/.test(o.n));

// как ответить на поле u, если верна запись r
function plan(u, r) {
  if (!u) return { ok: false };
  const chunks = answerChunks(r.a);

  if (u.kind === 'checkbox') {
    const sc = u.options.map((o) => optScore(o.n, r.na, chunks));
    let picks = sc.map((x, i) => (x.s >= 0.8 ? i : -1)).filter((i) => i >= 0);
    const strong = picks.filter((i) => sc[i].how !== 'fuzzy').map((i) => u.options[i].n);
    picks = picks.filter((i) => {
      const x = sc[i];
      if (x.how === 'fuzzy') return !(x.chunk && strong.some((n) => x.chunk.includes(n)));
      if (x.how === 'sub') {
        return !picks.some((j) => j !== i && sc[j].span && sc[j].span[0] <= x.span[0] && sc[j].span[1] >= x.span[1] &&
          sc[j].span[1] - sc[j].span[0] > x.span[1] - x.span[0]);
      }
      return true;
    });
    // два «нечётких» варианта на один и тот же кусок ответа — оставляем лучший
    const byChunk = new Map();
    for (const i of picks) {
      const c = sc[i].how === 'fuzzy' ? sc[i].chunk : null;
      if (!c) continue;
      if (!byChunk.has(c) || sc[byChunk.get(c)].raw < sc[i].raw) byChunk.set(c, i);
    }
    picks = picks.filter((i) => sc[i].how !== 'fuzzy' || !sc[i].chunk || byChunk.get(sc[i].chunk) === i);
    if (!picks.length && ALL_RE.test(r.na)) return { ok: true, picks: u.options.map((_, i) => i), q: 0.9 };
    // номера вариантов: берём их, если по тексту ничего не нашлось или текст — их часть
    const dp = isNumericOpts(u) ? null : digitPicks(r.na, u.options.length);
    if (dp && (!picks.length || picks.every((i) => dp.includes(i))) && dp.length !== picks.length) {
      return { ok: true, picks: dp, q: picks.length ? 1 : 0.85, note: 'по номерам вариантов' };
    }
    return picks.length ? { ok: true, picks, q: avg(picks.map((i) => sc[i].s)) } : { ok: false };
  }

  if (u.kind === 'radio' || u.kind === 'select') {
    const sc = u.options.map((o) => optScore(o.n, r.na, chunks));
    const order = sc.map((x, i) => i).sort((i, j) =>
      sc[j].s - sc[i].s || (sc[j].s >= 0.8 ? u.options[j].n.length - u.options[i].n.length : 0));
    const [b, second] = order;
    if (b === undefined) return { ok: false };
    const clear = sc[b].raw >= 0.6 && sc[b].raw - (second === undefined ? 0 : sc[second].raw) >= 0.2;
    if (sc[b].s >= 0.75 || clear) return { ok: true, picks: [b], q: Math.max(sc[b].s, 0.6) };
    const dp = u.kind === 'radio' && !isNumericOpts(u) ? digitPicks(r.na, u.options.length) : null;
    if (dp && dp.length === 1 && r.na.split(' ').length <= 2) return { ok: true, picks: dp, q: 0.7, note: 'по номеру варианта' };
    return { ok: false };
  }

  if (u.kind === 'text') {
    let v = (r.a.split(/[;\n]/).map((s) => s.trim()).filter(Boolean)[0] || r.a).replace(/[.;]+$/, '');
    const hint = u.hint || '';
    if (/маленьк\S* букв|строчн\S* букв/i.test(hint)) v = v.toLowerCase();
    else if (/(заглавн|большой|прописн)\S* букв/i.test(hint)) v = v.charAt(0).toUpperCase() + v.slice(1);
    return { ok: true, value: v, q: 0.8 };
  }
  return { ok: false };
}

function rank(recs, cands, u, th) {
  if (!cands.length) return [];
  const floor = Math.max(0.3, th - 0.2);
  const pre = [];
  for (const r of recs) {
    if (r.unknown) continue;
    const qs = qScore(cands, r);
    if (qs >= floor) pre.push({ r, qs });
  }
  pre.sort((a, b) => b.qs - a.qs);
  const top = pre.slice(0, 30);
  for (const m of top) {
    m.plan = plan(u, m.r);
    m.score = m.qs + (m.plan.ok ? 0.15 * (m.plan.q || 1) : 0) - (m.r.doubt ? 0.05 : 0);
  }
  return top.sort((a, b) => b.score - a.score);
}
function collectUnits() {
  const wrappers = [...document.querySelectorAll('.wrapper-problem-response')];
  const fields = [...document.querySelectorAll('.problem .capa_inputtype, .problem .inputtype')]
    .filter(el => !el.closest('.wrapper-problem-response') && !el.querySelector('.capa_inputtype, .inputtype'));
  return [...wrappers, ...fields];
}

function optionLabel(input) {
  const root = input.closest('.wrapper-problem-response, .problem, form') || document;
  let lab = input.id ? root.querySelector(`label[for="${cssEsc(input.id)}"]`) : null;
  return lab || input.closest('label') || input.parentElement;
}

function questionTexts(el) {
  const own = [el.querySelector('legend'), el.querySelector('.problem-group-label')]
    .map((e) => textOf(e)).filter(Boolean).join(' ');

  // заголовок задания: на openedu формулировка вопроса часто стоит именно там.
  // h3.problem-header лежит в .problems-wrapper рядом с .problem, а не внутри него
  const box = el.closest('.problems-wrapper, [data-problem-id], .xblock-student_view-problem');
  const header = textOf(box && box.querySelector('.problem-header'));
  const pidInput = box && box.querySelector('input[type=hidden][name=problem_id]');
  const pid = pidInput ? String(pidInput.value || '').replace(/\s+/g, ' ').trim() : '';

  // текст внутри блока ответа, но вне самих вариантов (списки «А. … Б. …», пояснения к полю)
  const inside = [...el.children]
    .filter((c) => !c.matches('.capa_inputtype, .inputtype, .choicegroup, .pv-badge') && !c.querySelector('input, select, textarea'))
    .map((c) => textOf(c)).filter(Boolean).join(' ').slice(0, 800);

  // формулировка часто стоит перед полем ответа отдельным абзацем
  let start = el;
  while (start && !start.previousElementSibling && start.parentElement &&
    !start.parentElement.matches('.problem, .problems-wrapper, body')) start = start.parentElement;
  const parts = [];
  let n = start && start.previousElementSibling;
  for (let guard = 0; n && guard < 12; guard++) {
    if (n.matches('.pv-badge, script, style')) { n = n.previousElementSibling; continue; }
    if (n.matches('.wrapper-problem-response') || n.querySelector('.wrapper-problem-response, input, select, textarea')) break;
    const t = textOf(n);
    if (t) parts.unshift(t);
    n = n.previousElementSibling;
  }
  const before = parts.join(' ').slice(-800);

  const out = [];
  const add = (...xs) => { const t = xs.filter(Boolean).join(' ').trim(); if (t.length >= 4) out.push(t); };
  if (own) add(own);
  if (header) add(header);
  if (pid && pid !== header) add(pid);
  if (before) add(before);
  if (own && before) add(before, own);
  if (header && own) add(header, own);
  if (inside && (header || own)) add(header || own, inside);
  if (!out.length && inside) add(inside);
  return { texts: [...new Set(out)], hint: [header, pid, own, before, inside].filter(Boolean).join(' ') };
}

function describe(el) {
  const radios = [...el.querySelectorAll('input[type=radio]')];
  const checks = [...el.querySelectorAll('input[type=checkbox]')];
  const texts = [...el.querySelectorAll('input[type=text], input:not([type]), textarea')];
  const selects = [...el.querySelectorAll('select')];
  const qt = questionTexts(el);
  const u = { el, kind: 'other', inputs: [], options: [], qTexts: qt.texts, hint: qt.hint };
  if (radios.length || checks.length) {
    u.kind = radios.length ? 'radio' : 'checkbox';
    u.inputs = radios.length ? radios : checks;
    u.options = u.inputs.map((inp) => {
      const label = optionLabel(inp);
      const text = textOf(label);
      return { el: inp, label, text, n: norm(stripEnum(text)) };
    });
  } else if (selects.length === 1) {
    u.kind = 'select';
    u.inputs = selects;
    u.options = [...selects[0].options]
      .filter((o) => o.value && !/dummy/i.test(o.value) && o.textContent.trim())
      .map((o) => ({ el: o, text: o.textContent.trim(), n: norm(stripEnum(o.textContent)) }));
  } else if (texts.length === 1) {
    u.kind = 'text';
    u.inputs = texts;
  }
  return u;
}

export { courseKey, parsePolyvsp };

// Some courses put several independent fields in one response wrapper.
function fieldsIn(el) {
  const controls = [...el.querySelectorAll('select, textarea, input[type="text"], input:not([type])')];
  const choices = [...el.querySelectorAll('input[type="radio"], input[type="checkbox"]')];
  if (choices.length) {
    const radioNames = new Set(choices.filter(i => i.type === 'radio').map(i => i.name));
    if (radioNames.size <= 1 && !controls.length) return [describe(el)];
    const groups = [...el.querySelectorAll('fieldset')].filter(f => !f.querySelector('fieldset'));
    return groups.map(describe);
  }
  if (controls.length < 2) return [describe(el)];
  const outer = questionTexts(el);
  const fields = controls.map(input => {
    const label = [...(input.labels || [])].map(l => textOf(l)).join(' ').trim();
    const line = input.closest('tr, li, p');
    const nearby = line && el.contains(line) ? textOf(line) : '';
    const texts = [...new Set([label, nearby].filter(Boolean))];
    // Require a field-specific prompt before looking up one part of a compound question.
    if (!texts.length) return null;
    const options = input.tagName === 'SELECT' ? [...input.options].filter(o => o.value && !/dummy/i.test(o.value))
      .map(o => ({ el: o, text: o.text.trim(), n: norm(stripEnum(o.text)) })) : [];
    return { el, kind: input.tagName === 'SELECT' ? 'select' : 'text', inputs: [input], options,
      qTexts: texts, hint: [outer.hint, ...texts].filter(Boolean).join(' ') };
  }).filter(Boolean);
  return fields.filter(f => fields.filter(other => other.qTexts[0] === f.qTexts[0]).length === 1);
}

export function openQuestions() {
  return collectUnits().flatMap(fieldsIn).filter(u => u.kind !== 'other' && u.qTexts.length && u.inputs.length)
    .map(u => {
      const field = { ...u, input: u.inputs[0], options: u.options.map(o => ({ ...o, value: o.el.value })) };
      return { q: u.qTexts[0], kind: u.kind, texts: u.qTexts, fields: [field],
        wire: { q: u.qTexts[0], kind: u.kind, full: u.hint, choices: u.options.map(o => o.text) } };
    });
}

export function polyAnswers(groups, rows) {
  const records = rows.map(([q, raw]) => {
    const a = cleanAnswer(raw);
    return { q, a: a.text, nq: norm(q), na: norm(a.text), doubt: a.doubt, unknown: a.unknown };
  });
  return groups.map(g => {
    const field = g.fields[0];
    return rank(records, g.texts.map(norm).filter(s => s.length >= 4).map(grams), field, 0.6)
      .filter(m => m.qs >= 0.6 && m.plan.ok).map(m => candidate(field, 'PolyVSP', m.plan, m.r.doubt)).filter(Boolean);
  });
}

export function openSkipAnswers(group, result) {
  if (!result?.found) return [];
  const field = group.fields[0];
  const answers = result.answers?.length ? result.answers : [result.answer];
  return answers.filter(a => typeof a === 'string' && a.trim()).map(a => {
    const match = plan(field, { a, na: norm(a) });
    return match.ok ? candidate(field, 'SkipEdu', match, ['soft', 'ai'].includes(result.confidence)) : null;
  }).filter(Boolean);
}
