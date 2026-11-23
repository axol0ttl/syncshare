import { browser, send, sourceKey } from './api';
import { courseKey, openQuestions, openSkipAnswers, parsePolyvsp, polyAnswers } from './openedu';
import { moodleQuestions, moodleAnswers } from './moodle';
import { syncShareContext, syncShareAnswers } from './syncshare';
import { applyAnswer, filled } from './fields';

const open = /(^|\.)openedu\.ru$/i.test(location.hostname);
const collect = open ? openQuestions : moodleQuestions;
const ttl = 12 * 3600_000;
let lastLookup, snapshot;
let sequence = 0;
const documentId = Math.random().toString(36).slice(2);

async function polyRows(url) {
  const key = 'rows:' + url;
  const cached = (await browser.storage.local.get(key))[key];
  if (cached && Date.now() - cached.time < ttl) return cached.rows;
  try {
    const rows = parsePolyvsp(await send('poly', { url }));
    if (!rows.length) throw new Error('На странице PolyVSP нет таблицы с ответами.');
    await browser.storage.local.set({ [key]: { time: Date.now(), rows } });
    return rows;
  } catch (e) {
    if (cached?.rows.length) return cached.rows;
    throw e;
  }
}

async function lookup(groups, course, context) {
  const notices = [];
  const answers = groups.map(g => g.fields.map(() => []));
  async function skip() {
    const data = await send('search', { items: groups.map(g => g.wire), course });
    if (data.unconfigured && (open || groups.some(g => !g.syncShare)))
      notices.push('Дополнительную базу SkipEdu можно подключить в настройках.');
    groups.forEach((g, i) => {
      const candidates = open ? [openSkipAnswers(g, data.results[i])] : moodleAnswers(g, data.results[i]);
      candidates.forEach((list, j) => answers[i][j].push(...list));
    });
  }
  async function poly() {
    const key = sourceKey(course);
    const stored = await browser.storage.local.get([key, sourceKey('')]);
    const urls = stored[key] || stored[sourceKey('')] || [];
    if (!urls.length) notices.push('Выберите страницы PolyVSP для этого курса в настройках.');
    const result = await Promise.allSettled(urls.map(polyRows));
    const rows = [];
    for (const page of result) {
      if (page.status === 'fulfilled') page.value.forEach(row => rows.push(row));
      else notices.push('PolyVSP · ' + page.reason.message);
    }
    polyAnswers(groups, rows).forEach((list, i) => answers[i][0].push(...list));
  }
  async function syncShare() {
    if (!groups.some(g => g.syncShare)) return;
    const names = { courseId: 'курса', quizId: 'теста', attemptId: 'попытки', moodleId: 'пользователя' };
    const missing = Object.keys(names).filter(key => !context[key]);
    if (missing.length) {
      notices.push('SyncShare · На странице Moodle не найден ID ' + missing.map(k => names[k]).join(', ') + '.');
      return;
    }
    await Promise.all(groups.map(async (g, i) => {
      if (!g.syncShare) return;
      try {
        const solutions = await send('solution', { query: { ...context, ...g.syncShare.query } });
        syncShareAnswers(g, solutions, answers[i], notices);
      } catch (e) { notices.push('SyncShare · ' + e.message); }
    }));
  }
  const results = await Promise.allSettled([skip(), open ? poly() : syncShare()]);
  results.forEach((r, i) => { if (r.status === 'rejected') notices.push((i === 0 ? 'SkipEdu · ' : '') + r.reason.message); });
  return { answers, notices };
}

function lookupKey(course, groups, context) {
  return JSON.stringify([course, context, groups.map(g => [g.wire, g.texts, g.syncShare])]);
}

async function scan(request) {
  const groups = collect();
  const course = request.course || courseKey(location.href);
  const context = open ? null : syncShareContext();
  const key = lookupKey(course, groups, context);
  if (request.refresh || lastLookup?.key !== key) {
    lastLookup = { key, promise: groups.length ? lookup(groups, course, context) : Promise.resolve({ answers: [], notices: [] }) };
  }
  const current = lastLookup;
  const { answers, notices } = await current.promise;
  if (current !== lastLookup) return null;
  const entries = [];
  groups.forEach((g, i) => g.fields.forEach((field, j) => {
    const unique = new Map();
    for (const a of answers[i][j]) {
      const id = JSON.stringify([a.source, a.value, a.picks, a.label]);
      if (!unique.has(id) || (unique.get(id).manual && !a.manual)) unique.set(id, a);
    }
    entries.push({ field, title: g.q, caption: field.caption, answers: [...unique.values()] });
  }));
  const token = documentId + '-' + ++sequence;
  snapshot = { entries, token, key, course };
  return { token, notices, course, entries: entries.map(({ field, ...e }) => ({ ...e, filled: filled(field) })) };
}

async function apply(request) {
  if (request.token !== snapshot?.token) return { stale: true, count: 0 };
  const groups = collect();
  if (lookupKey(snapshot.course, groups, open ? null : syncShareContext()) !== snapshot.key)
    return { stale: true, count: 0 };
  const fields = groups.flatMap(g => g.fields);
  let count = 0;
  for (const { index, answer } of request.choices) {
    const entry = snapshot.entries[index];
    const field = fields[index];
    if (field?.input !== entry?.field.input) return { stale: true, count };
    if (entry?.answers[answer] && !entry.answers[answer].displayOnly && await applyAnswer(field, entry.answers[answer], request.onlyEmpty)) count++;
  }
  return { count };
}

export function installFrame(changed) {
  browser.runtime.onMessage.addListener(m => {
    if (m?.channel !== 'syncshare-frame') return;
    if (m.op === 'scan') return scan(m);
    if (m.op === 'apply') return Promise.resolve(apply(m));
    if (m.op === 'changed' && changed) { changed(); return Promise.resolve(true); }
  });
  let timer;
  function notify() {
    clearTimeout(timer);
    timer = setTimeout(() => changed ? changed() : send('changed').catch(() => {}), 350);
  }
  const selector = '.que, .problem, .wrapper-problem-response, .qtext, input, select, textarea, iframe';
  new MutationObserver(records => {
    if (records.some(r => r.target.parentElement?.closest('.qtext, .wrapper-problem-response') ||
      [...r.addedNodes, ...r.removedNodes].some(n => n.nodeType === 1 && (n.matches(selector) || n.querySelector(selector))))) notify();
  }).observe(document.body, { childList: true, characterData: true, subtree: true });
  document.addEventListener('change', notify);
  if (!changed) notify();
}
