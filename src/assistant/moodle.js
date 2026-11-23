import { candidate } from './fields';

const clean = el => {
  if (!el) return "";
  const c = el.cloneNode(true);
  c.querySelectorAll(".answernumber, .accesshide, .sr-only, script, style").forEach((x) => x.remove());
  return (c.innerText || c.textContent || "").replace(/ /g, " ").replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").trim();
};
// Вариант-картинка (формула вставлена рисунком): текста нет, и вариант нельзя ни
// найти в базе, ни запомнить (находки 3046–3050, exam1.urfu.ru, физика — все
// варианты пустые). Подписываем такой вариант отпечатком рисунка: у всех, кому
// попался этот вопрос, рисунок тот же. У файла из Moodle (pluginfile.php) в адресе
// есть номер попытки — берём только номер ответа и имя файла.
function imgToken(img) {
  const alt = String(img.getAttribute("alt") || "").trim();
  if (alt && /[\p{L}\p{N}]/u.test(alt) && !/\.(png|jpe?g|gif|svg|webp|wmf|emf)$/i.test(alt) && alt.length < 120) return alt;
  const src = String(img.getAttribute("src") || "");
  let key = src;
  const pf = src.match(/pluginfile\.php\/\d+\/question\/(?:answer|questiontext)\/\d+\/\d+\/(\d+)\/([^?#]+)/);
  if (pf) key = pf[1] + "/" + pf[2];
  else if (!/^data:/i.test(src)) key = src.split(/[?#]/)[0].replace(/^https?:\/\/[^/]+/, "");
  return key ? `[рис. ${hashStr(key)}]` : "";
}
function labelOf(input, que) {
  const lb = input.getAttribute("aria-labelledby");
  let el = lb && (que.ownerDocument || document).getElementById(lb);
  if (!el && input.id) el = que.querySelector(`label[for="${CSS.escape(input.id)}"]`);
  if (!el) el = input.closest("div");
  const text = clean(el);
  if (/[\p{L}\p{N}]/u.test(text) || !el) return text;
  const imgs = [...el.querySelectorAll("img")].map(imgToken).filter(Boolean);
  return imgs.length ? imgs.join(" ") : text;
}
// Одинаковая подпись у нескольких вариантов, а различаются они только рисунком
// (находка 3272, elearn.urfu.ru, гидравлика: пять раз «Отрезком» + формула).
// Ответ «Отрезком» из базы ставил первый попавшийся. Таким вариантам дописываем
// отпечаток рисунка: ответ без рисунка ни с одним не совпадёт, и вопрос
// останется человеку, а со страницы результатов база выучит уже различимый.
function twinSafe(inputs, que) {
  const base = inputs.map((i) => labelOf(i, que));
  const norm = base.map((t) => t.toLowerCase().replace(/\s+/g, " ").trim());
  return base.map((t, k) => {
    if (norm.indexOf(norm[k]) === norm.lastIndexOf(norm[k])) return t.slice(0, 600);
    const lb = inputs[k].getAttribute("aria-labelledby");
    let el = lb && (que.ownerDocument || document).getElementById(lb);
    if (!el && inputs[k].id) el = que.querySelector(`label[for="${CSS.escape(inputs[k].id)}"]`);
    if (!el) el = inputs[k].closest("div");
    const imgs = el ? [...el.querySelectorAll("img")].map(imgToken).filter(Boolean) : [];
    return (imgs.length ? t + " " + imgs.join(" ") : t).slice(0, 600);
  });
}
const supportedTypes = new Set(['multianswer', 'gapselect', 'match', 'ddwtos', 'multichoice',
  'truefalse', 'shortanswer', 'numerical', 'calculated', 'calculatedsimple']);
function typeOf(que) {
  return [...que.classList].find(name => supportedTypes.has(name)) || "";
}

// Выпадающий список ячейки: варианты без пустого «Выберите…»
function selectGap(el) {
  const opts = [...el.options].filter((o) => o.value !== "" && !(o.value === "0" && /^\s*(выб|choose|select|—|-|\.\.\.|$)/i.test(o.text)) && o.text.trim());
  return { el, kind: "select", opts, choices: opts.map((o) => o.text.replace(/\s+/g, " ").trim().slice(0, 300)) };
}
// Подвопрос с переключателями внутри теста с пропусками (exam1.urfu.ru, dl-hum,
// 1.10.11): блок fieldset с radio …subN_answer. Для сервера это выбор из
// вариантов, как выпадающий список; на странице — нажатие на нужный переключатель.
function radioGap(fs) {
  const radios = [...fs.querySelectorAll('input[type="radio"]')].filter((r) => /sub\d+_answer$/.test(r.name));
  if (radios.length < 2) return null;
  const choices = radios.map((r) => labelOf(r, fs).replace(/^[a-zа-я]\.\s*/i, "").replace(/\s+/g, " ").trim().slice(0, 300));
  if (choices.some((x) => !x)) return null;
  return { el: fs, kind: "select", radio: true, radios, opts: radios.map((r, i) => ({ value: String(i), text: choices[i] })), choices };
}
// Текст с {{sub}} на месте каждой ячейки — так же записаны такие вопросы в базе
function textWithGaps(root, gapEls) {
  const c = root.cloneNode(true);
  const all = [...root.querySelectorAll("input, select, fieldset")];
  const call = [...c.querySelectorAll("input, select, fieldset")];
  gapEls.forEach((g) => { const k = all.indexOf(g); if (k >= 0 && call[k]) call[k].replaceWith(document.createTextNode("{{sub}}")); });
  c.querySelectorAll(".accesshide, .sr-only, script, style, .feedbackspan, .validationerror, .im-feedback, .questiontestslink").forEach((x) => x.remove());
  // Ячейки и абзацы — с новой строки, как в тексте страницы (иначе «1110{{sub}}» слипается)
  c.querySelectorAll("p, div, td, th, tr, li, br, h1, h2, h3, h4, h5, h6").forEach((x) => x.after(document.createTextNode("\n")));
  return (c.textContent || "").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").replace(/\n{2,}/g, "\n").trim();
}
function parseGapped(que, type) {
  if (type === "multianswer") {
    const f = que.querySelector(".formulation");
    if (!f) return null;
    const els = [...f.querySelectorAll('input[type="text"], select, fieldset')].filter((el) => (el.tagName === "FIELDSET"
      ? !!el.querySelector('input[type="radio"]') && [...el.querySelectorAll('input[type="radio"]')].every((r) => /sub\d+_answer$/.test(r.name))
      : /sub\d+_answer$/.test(el.name)));
    if (!els.length) return null;
    const gaps = els.map((el) => (el.tagName === "FIELDSET" ? radioGap(el) : el.tagName === "SELECT" ? selectGap(el) : { el, kind: "text" }));
    if (gaps.some((g) => !g)) return null;
    return { kind: "cloze", q: textWithGaps(f, els), gaps };
  }
  if (type === "gapselect") {
    const qt = que.querySelector(".qtext");
    const els = qt ? [...qt.querySelectorAll("select")] : [];
    if (!els.length) return null;
    return { kind: "cloze", q: textWithGaps(qt, els), gaps: els.map(selectGap) };
  }
  // Перетащить слова в пропуски (ddwtos): выбор хранится в скрытых полях
  // placeN (номер варианта choiceK своей группы), слова — в .draghome
  if (type === "ddwtos") {
    const qt = que.querySelector(".qtext");
    const drops = qt ? [...qt.querySelectorAll("span.drop")].filter((sp) => /\bplace\d+\b/.test(sp.className)) : [];
    if (!drops.length) return null;
    const gaps = [];
    for (const sp of drops) {
      const place = (sp.className.match(/\bplace(\d+)\b/) || [])[1];
      const group = (sp.className.match(/\bgroup(\d+)\b/) || [])[1] || "1";
      const el = que.querySelector(`input.placeinput.place${place}`) || que.querySelector(`input[name$="_p${place}"]`);
      if (!el) return null;
      const seen = new Map();
      que.querySelectorAll(`.draghome.group${group}`).forEach((h) => {
        const k = (h.className.match(/\bchoice(\d+)\b/) || [])[1];
        const t = (h.textContent || "").replace(/\s+/g, " ").trim();
        if (k && t && !seen.has(k)) seen.set(k, t);
      });
      const opts = [...seen.entries()].sort((a, b) => a[0] - b[0]).map(([k, t]) => ({ value: String(k), text: t }));
      if (!opts.length) return null;
      gaps.push({ el, kind: "select", drop: sp, place, opts, choices: opts.map((o) => o.text.slice(0, 300)) });
    }
    const c = qt.cloneNode(true);
    c.querySelectorAll("span.drop").forEach((x) => x.replaceWith(document.createTextNode("{{sub}}")));
    c.querySelectorAll(".draghome, .accesshide, .sr-only, script, style, input").forEach((x) => x.remove());
    c.querySelectorAll("p, div, td, th, tr, li, br").forEach((x) => x.after(document.createTextNode("\n")));
    const q = (c.textContent || "").replace(/ /g, " ").replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").replace(/\n{2,}/g, "\n").trim();
    return { kind: "cloze", q, gaps };
  }
  if (type === "match") {
    const rows = [...que.querySelectorAll(".answer tr, table.answer tr")].filter((tr) => tr.querySelector("select"));
    if (rows.length < 2) return null;
    // Строка-картинка без текста (находка 3175, exam1.urfu.ru: «Match the vocabulary
    // to the pictures») — подписываем её alt или отпечатком рисунка, как варианты
    const stems = rows.map((tr) => {
      const cell = tr.querySelector(".text") || tr.cells[0];
      const t = clean(cell);
      if (/[\p{L}\p{N}]/u.test(t) || !cell) return t.slice(0, 300);
      return [...cell.querySelectorAll("img")].map(imgToken).filter(Boolean).join(" ").slice(0, 300);
    });
    if (stems.some((x) => !x)) return null;
    const q = clean(que.querySelector(".qtext"));
    return { kind: "match", q, stems, gaps: rows.map((tr) => selectGap(tr.querySelector("select"))) };
  }
  return null;
}
function parse(root = document) {
  const out = [];
  root.querySelectorAll(".que").forEach((que) => {
    if (que.matches(".qtype_ddwtos-readonly") || que.querySelector(".answercontainer.readonly, .drop.readonly")) return;
    const type = typeOf(que);
    if (["multianswer", "gapselect", "match", "ddwtos"].includes(type)) {
      const g = parseGapped(que, type);
      if (!g?.q) return;
      out.push({ que, type, kind: g.kind, q: g.q.slice(0, 20000), stems: g.stems, gaps: g.gaps, inputs: g.gaps.map((x) => x.el),
                 choices: [] });
      return;
    }
    const qtext = clean(que.querySelector(".qtext"));
    if (!qtext) return;
    const block = que.querySelector(".ablock, .answer") || que;
    // Скрытая радиокнопка «Очистить мой выбор» (value -1) — не вариант
    const radios = [...block.querySelectorAll('input[type="radio"]')].filter((i) => i.value !== "-1");
    const boxes = [...block.querySelectorAll('input[type="checkbox"]')].filter((i) => !/flag/.test(i.name));
    const texts = [...block.querySelectorAll('input[type="text"]')];
    let kind = null, inputs = [];
    if ((type === "multichoice" || type === "truefalse" || !type) && radios.length >= 2) { kind = "radio"; inputs = radios; }
    else if ((type === "multichoice" || !type) && boxes.length >= 2) { kind = "checkbox"; inputs = boxes; }
    else if ((type === "shortanswer" || type === "numerical" || type === "calculated" || type === "calculatedsimple") && texts.length === 1) { kind = "text"; inputs = texts; }
    if (!kind) return;

    out.push({
      que, kind, inputs,
      q: qtext.slice(0, 3000),
      choices: kind === "text" ? [] : twinSafe(inputs, que),
    });
  });
  return out;
}
function hashStr(str) {                     // FNV-1a — короткий отпечаток для находки
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}


export function moodleQuestions() {
  return parse().map(it => {
    const wire = { q: it.q, kind: it.kind, choices: it.choices };
    let fields;
    if (it.gaps) {
      wire.stems = it.stems;
      wire.gaps = it.gaps.map(g => ({ kind: g.kind, choices: g.choices || [] }));
      fields = it.gaps.map((g, i) => {
        const group = g.el.className.match(/\bgroup(\d+)\b/)?.[1] || '1';
        const options = (g.opts || []).map((o, j) => ({
          value: o.value, text: o.text, el: g.radio ? g.radios[j] : g.drop ? undefined : o,
          repeat: g.drop && !!it.que.querySelector('.draghome.group' + group + '.choice' + o.value + '.infinite')
        }));
        return { input: g.radio ? g.radios[0] : g.el, kind: g.radio ? 'radio' : g.kind, options,
          drop: g.drop, place: g.place, group, root: it.que, caption: it.stems?.[i] || 'Пропуск ' + (i + 1) };
      });
    } else {
      fields = [{ input: it.inputs[0], kind: it.kind, options: it.choices.map((text, i) => ({ text, el: it.inputs[i] })) }];
    }
    return { q: it.q, fields, wire };
  });
}

export function moodleAnswers(group, result) {
  return group.fields.map((field, i) => {
    if (!result?.found) return [];
    const part = group.wire.gaps ? result.gaps?.[i] : result;
    if (!part) return [];
    const picks = Array.isArray(part.select) ? part.select : [part.select];
    const answer = candidate(field, 'SkipEdu', { picks, value: part.text }, result.confidence === 'soft');
    return answer ? [answer] : [];
  });
}
