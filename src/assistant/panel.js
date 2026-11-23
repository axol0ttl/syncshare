import { browser, send } from './api';
import { courseKey } from './openedu';
import markUrl from '../icons/icon@48.png';
import css from '../styles/assistant.css';

function element(tag, text, cls) {
  const el = document.createElement(tag);
  if (text) el.textContent = text;
  if (cls) el.className = cls;
  return el;
}
function button(text, fn, cls) {
  const b = element('button', text, cls);
  b.type = 'button';
  b.addEventListener('click', fn);
  return b;
}
export const hasBoth = entry => ['PolyVSP', 'SkipEdu'].every(src => entry.answers.some(a => a.source === src));
export function preferred(entry, preference) {
  if (!preference && hasBoth(entry)) return -1;
  const eligible = entry.answers.map((a, i) => ({ ...a, i })).filter(a => !a.manual);
  return (eligible.find(a => a.source === preference) || eligible[0])?.i ?? -1;
}

export function panel() {
  const openEdu = /(^|\.)openedu\.ru$/.test(location.hostname);
  const host = element('div');
  host.setAttribute('data-syncshare', '');
  const root = host.attachShadow({ mode: 'closed' });
  root.append(element('style', css));
  document.body.append(host);
  const panel = element('section');
  panel.setAttribute('aria-label', 'Подсказки SyncShare');
  panel.hidden = true;
  const launcher = button('SyncShare', () => {
    toggle(panel.hidden);
    if (!panel.hidden) refresh(false);
  }, 'launcher');
  const mark = element('img', '', 'mark');
  mark.src = markUrl;
  mark.alt = '';
  launcher.prepend(mark);
  function toggle(show) {
    panel.hidden = !show;
    launcher.setAttribute('aria-expanded', String(show));
  }
  toggle(false);
  root.append(panel, launcher);

  const head = element('header');
  const title = element('div');
  title.append(element('small', openEdu ? 'OpenEdu' : 'Moodle'), element('h2', 'Ответы'));
  const close = button('×', () => { toggle(false); launcher.focus(); }, 'icon');
  close.setAttribute('aria-label', 'Свернуть панель');
  head.append(title, close);
  const status = element('p', '', 'status');
  status.setAttribute('role','status');
  const prompt = element('div', '', 'prompt');
  const list = element('div', '', 'list');
  const notices = element('div', '', 'notes');
  const foot = element('footer');
  const fill = button('Заполнить пропуски', () => fillPage(), 'primary');
  const reload = button('Обновить', () => refresh(true), 'link');
  const settings = button('Настройки', () => send('settings', { course: currentCourse() }).catch(fail), 'link');
  foot.append(fill, reload, settings);
  panel.append(head, status, prompt, list, notices, foot);

  let reports = [], preference, ready = false, busy = false, pending = false, forceNext = false;
  let asked = false, fillAfterChoice = false;
  const currentCourse = () => courseKey(location.href) || reports.find(r => r.course)?.course || '';
  const entries = () => reports.flatMap(r => r.entries.map((e, index) => ({ ...e, index, report: r })));
  const conflict = () => !preference && entries().some(hasBoth);
  const fail = e => { status.textContent = e.message || 'Не удалось получить ответы.'; };
  function draw() {
    const rows = entries();
    const found = rows.filter(r => r.answers.length);
    const opened = new Set([...list.querySelectorAll('details[open]')].map(d => d.dataset.key));
    list.replaceChildren();
    prompt.replaceChildren();
    prompt.hidden = !conflict();
    if (!prompt.hidden) {
      if (!asked) { toggle(true); asked = true; }
      prompt.append(element('strong', 'Какую базу предпочитаете?'),
        element('p', 'Обе базы нашли ответ. Запомним ваш выбор для следующих заданий.'));
      for (const source of ['PolyVSP', 'SkipEdu']) prompt.append(button(source, async () => {
        await browser.storage.local.set({ preference: source });
        preference = source;
        draw();
        if (fillAfterChoice) { fillAfterChoice = false; await fillPage(); }
      }));
    }
    for (const row of found) {
      const selected = preferred(row, preference);
      const first = selected >= 0 ? selected : 0;
      const detail = element('details');
      detail.dataset.key = JSON.stringify([row.report.frameId, row.index, row.title]);
      detail.open = opened.has(detail.dataset.key);
      const summary = element('summary');
      const caption = row.title.replaceAll('{{sub}}', '___');
      summary.append(element('span', row.caption ? row.caption + ' · ' + caption : caption, 'question'),
        element('b', row.answers[first].label), element('small', row.answers[first].source + (row.filled ? ' · заполнено' : '')));
      detail.append(summary);
      for (const [i, a] of row.answers.entries()) {
        const pick = button('', () => apply([{ row, answer: i }], false), 'option');
        pick.disabled = !!a.displayOnly;
        pick.append(element('small', a.source + (a.percent != null ? ' · ' + a.percent + '%' : '') + (a.displayOnly ? ' · для справки' : a.manual ? ' · проверьте' : '')), element('span', a.label));
        detail.append(pick);
      }
      list.append(detail);
    }
    notices.replaceChildren(...[...new Set(reports.flatMap(r => r.notices))].map(n => element('p', n)));
    status.textContent = rows.length ? 'Найдены ответы для ' + found.length + ' из ' + rows.length + ' полей.'
      : 'На этой странице пока нет поддерживаемых полей.';
    fill.disabled = busy || !found.some(r => !r.filled && (preferred(r, preference) >= 0 || hasBoth(r)));
    reload.disabled = busy;
  }
  async function refresh(force = false) {
    if (!ready) return;
    if (busy) { pending = true; forceNext ||= force; return; }
    busy = true;
    fill.disabled = reload.disabled = true;
    status.textContent = 'Ищем ответы…';
    let error;
    try {
      reports = await send('scan', { course: courseKey(location.href), refresh: force });
    } catch (e) { reports = []; error = e; }
    finally { busy = false; }
    draw();
    if (error) fail(error);
    if (pending) {
      const force = forceNext;
      pending = forceNext = false;
      await refresh(force);
    }
  }
  async function apply(work, onlyEmpty) {
    if (busy) return;
    busy = true;
    fill.disabled = reload.disabled = true;
    let count = 0, stale = false;
    let error;
    try {
      for (const r of reports) {
        const choices = work.filter(w => w.row.report === r).map(w => ({ index: w.row.index, answer: w.answer }));
        if (!choices.length) continue;
        const res = await send('apply', { frameId: r.frameId, token: r.token, choices, onlyEmpty });
        if (!res) { stale = true; continue; }
        count += res.count;
        stale ||= res.stale;
      }
    } catch (e) { error = e; }
    finally { busy = false; }
    await refresh();
    if (error) fail(error);
    else status.textContent = 'Заполнено полей: ' + count + '.' + (stale ? ' Страница изменилась, подсказки обновлены.' : '');
  }
  function fillPage() {
    if (conflict()) { fillAfterChoice = true; toggle(true); prompt.querySelector('button')?.focus(); return; }
    const work = entries().filter(r => !r.filled).map(row => ({ row, answer: preferred(row, preference) })).filter(w => w.answer >= 0);
    return apply(work, true);
  }
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.preference) { preference = changes.preference.newValue; asked = false; draw(); }
    if (changes.skipKey || Object.keys(changes).some(k => k.startsWith('poly:'))) refresh(true);
  });
  root.addEventListener('keydown', e => { if (e.key === 'Escape') { toggle(false); launcher.focus(); } });
  browser.storage.local.get('preference').then(s => { preference = s.preference; ready = true; refresh(); });
  return () => refresh();
}
