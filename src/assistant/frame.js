import { browser, send, sourceKey } from './api';
import { courseKey, openQuestions, openSkipAnswers, parsePolyvsp, polyAnswers } from './openedu';
import { moodleQuestions, moodleAnswers } from './moodle';
import { quizMeta } from '../content/quiz/main';
import { applyAnswer, filled, candidate } from './fields';

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

async function lookup(groups, course) {
  const notices = [];
  const answers = groups.map(g => g.fields.map(() => []));
  async function skip() {
    const data = await send('search', { items: groups.map(g => g.wire), course });
    if (data.notice) notices.push(data.notice);
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
  async function legacy() {
    // Preserve suggestions from the existing Moodle service in the shared menu.
    const { host, quizId, courseId } = quizMeta();
    await Promise.all(groups.map(async (g, i) => {
      const data = g.fields[0].input.closest('.que')?.querySelector('.questionflagpostdata')?.value;
      const qId = Number(new URLSearchParams(data).get('qid'));
      if (!qId || g.fields.length !== 1) return;
      const solutions = await browser.runtime.sendMessage({ type: 'solution-request', payload: {
        host, quizId, courseId, qId
      } });
      const f = g.fields[0];
      for (const sol of solutions || []) {
        for (const item of [...(sol.suggestions || []), ...(sol.submissions || [])]) {
          const sign = item.item?.data?.sign;
          const idx = f.options.findIndex(o => o.text === sign);
          const a = candidate(f, 'SyncShare', { picks: [idx], value: item.item?.data?.text }, true);
          if (a && item.correctness !== 0) answers[i][0].push(a);
        }
      }
    }));
  }
  const results = await Promise.allSettled([skip(), open ? poly() : legacy()]);
  results.forEach((r, i) => { if (r.status === 'rejected') notices.push((i === 0 ? 'SkipEdu · ' : '') + r.reason.message); });
  return { answers, notices };
}

async function scan(request) {
  const groups = collect();
  const course = request.course || courseKey(location.href);
  const key = JSON.stringify([course, groups.map(g => [g.wire, g.texts])]);
  if (request.refresh || lastLookup?.key !== key) {
    lastLookup = { key, promise: groups.length ? lookup(groups, course) : Promise.resolve({ answers: [], notices: [] }) };
  }
  const current = lastLookup;
  const { answers, notices } = await current.promise;
  if (current !== lastLookup) return null;
  const entries = [];
  groups.forEach((g, i) => g.fields.forEach((field, j) => {
    const unique = new Map();
    for (const a of answers[i][j]) {
      const id = JSON.stringify([a.source, a.value, a.picks]);
      if (!unique.has(id) || !a.manual) unique.set(id, a);
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
  if (JSON.stringify([snapshot.course, groups.map(g => [g.wire, g.texts])]) !== snapshot.key)
    return { stale: true, count: 0 };
  const fields = groups.flatMap(g => g.fields);
  let count = 0;
  for (const { index, answer } of request.choices) {
    const entry = snapshot.entries[index];
    const field = fields[index];
    if (field?.input !== entry?.field.input) return { stale: true, count };
    if (entry?.answers[answer] && await applyAnswer(field, entry.answers[answer], request.onlyEmpty)) count++;
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
