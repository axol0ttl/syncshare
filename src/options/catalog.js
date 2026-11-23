import { browser, polyUrl, sourceKey } from '../assistant/api';

const catalogURL = 'https://polyvsp.ru/vibpredmet/';
const cacheKey = 'polyvspCatalog';
const week = 7 * 24 * 60 * 60 * 1000;
const normalize = value => value.trim().toLocaleLowerCase('ru').replaceAll('ё', 'е');

function coursesFrom(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const headings = doc.querySelectorAll('h2 a[href], h3 a[href], h4 a[href]');
  const links = headings.length ? headings : doc.querySelectorAll('main a[href], .entry-content a[href]');
  const courses = new Map();
  for (const link of links) {
    let url;
    try { url = new URL(link.getAttribute('href'), catalogURL); } catch { continue; }
    const slug = url.pathname.match(/^\/([^/]+)\/?$/)?.[1];
    if (!slug || !/^https?:$/.test(url.protocol) || !/^(www\.)?polyvsp\.ru$/i.test(url.hostname) ||
        /^(vibpredmet|page|category|tag|author|feed|comments|wp-|maga|oshibkikurs|perevod|loyaltysystem)/i.test(slug)) continue;
    const title = link.textContent.replace(/\s+/g, ' ').trim();
    if (title) courses.set('https://polyvsp.ru/' + slug + '/', title);
  }
  return [...courses].map(([url, title]) => ({ url, title }));
}

export async function setupCatalog(course) {
  const el = id => document.getElementById(id);
  const scope = el('course');
  if (course) {
    scope.add(new Option('Текущий курс · ' + course, course), 0);
    scope.value = course;
  }
  let selected = new Set();
  let courses = [];
  let loadingScope = false;
  let saving = false;

  function render() {
    const filter = normalize(el('course-search').value);
    const items = new Map(courses.map(c => [c.url, c.title]));
    for (const url of selected) if (!items.has(url)) items.set(url, url);
    const matches = [...items].filter(([url, title]) => normalize(title + ' ' + url).includes(filter));
    const list = el('course-list');
    list.replaceChildren();
    for (const [url, title] of matches) {
      const label = document.createElement('label');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.value = url;
      box.checked = selected.has(url);
      box.onchange = () => {
        if (box.checked) selected.add(url);
        else selected.delete(url);
        el('selected-count').textContent = 'Выбрано: ' + selected.size;
      };
      label.append(box, title);
      list.append(label);
    }
    if (!matches.length && (filter || items.size)) list.textContent = 'Ничего не найдено.';
    el('selected-count').textContent = 'Выбрано: ' + selected.size;
  }

  async function loadScope() {
    const key = sourceKey(scope.value);
    loadingScope = true;
    el('subjects').disabled = true;
    const stored = await browser.storage.local.get([key, sourceKey('')]);
    if (sourceKey(scope.value) !== key) return;
    selected = new Set(stored[key] || stored[sourceKey('')] || []);
    el('course-search').value = '';
    el('custom-url').value = '';
    el('status').textContent = '';
    loadingScope = false;
    el('subjects').disabled = false;
    render();
  }

  async function loadCatalog(force) {
    const refresh = el('reload-catalog');
    refresh.disabled = true;
    const note = el('catalog-status');
    note.textContent = 'Загружаем каталог…';
    try {
      const cached = (await browser.storage.local.get(cacheKey))[cacheKey];
      if (cached?.courses?.length) { courses = cached.courses; render(); }
      if (force || !courses.length || Date.now() - cached?.time >= week) {
        const response = await fetch(catalogURL, { credentials: 'omit', signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw new Error();
        const fresh = coursesFrom(await response.text());
        if (!fresh.length) throw new Error();
        courses = fresh;
        await browser.storage.local.set({ [cacheKey]: { courses, time: Date.now() } });
      }
      note.textContent = '';
    } catch {
      note.textContent = courses.length ? 'Каталог недоступен. Показан сохранённый список.'
        : 'Не удалось загрузить каталог. Попробуйте обновить его или добавьте ссылку вручную.';
    } finally {
      refresh.disabled = false;
      render();
    }
  }

  scope.onchange = () => loadScope().catch(err => { el('status').textContent = err.message; });
  el('course-search').oninput = render;
  el('reload-catalog').onclick = () => loadCatalog(true);
  el('poly').onsubmit = async event => {
    event.preventDefault();
    if (loadingScope || saving) return;
    const key = sourceKey(scope.value);
    try {
      saving = true;
      scope.disabled = el('subjects').disabled = true;
      const custom = el('custom-url').value.trim();
      if (custom) selected.add(polyUrl(custom));
      await browser.storage.local.set({ [key]: [...selected] });
      el('custom-url').value = '';
      el('status').textContent = 'Выбор предметов сохранён.';
      render();
    } catch (err) { el('status').textContent = err.message; }
    finally { saving = false; scope.disabled = el('subjects').disabled = false; }
  };
  await Promise.all([loadScope(), loadCatalog(false)]);
}
