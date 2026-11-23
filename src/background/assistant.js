import { browser, polyUrl } from '../assistant/api';

const api = 'https://api.skipedu.xyz';
const isOpen = url => /^https:\/\/(?:[\w-]+\.)*openedu\.ru(?:\/|$)/i.test(url || '');
const toFrame = (tab, frameId, payload) => browser.tabs.sendMessage(tab, { channel: 'syncshare-frame', ...payload }, { frameId });
const optionsUrl = browser.runtime.getURL('options.html');

async function skipPost(path, key, device, payload) {
  const response = await fetch(api + path, {
    method: 'POST', credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(15000),
    headers: { 'Content-Type': 'application/json', 'X-Device-Id': device, 'X-Ext-Version': browser.runtime.getManifest().version },
    body: JSON.stringify({ ...payload, key })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error('SkipEdu · ' + (data.error || 'HTTP ' + response.status));
  return data;
}

async function handle(m, sender) {
  const tab = sender.tab?.id;
  if (m.op === 'login') {
    if (sender.url?.split('?')[0] !== optionsUrl) throw new Error('Откройте настройки SyncShare.');
    const { device = crypto.randomUUID() } = await browser.storage.local.get('device');
    await browser.storage.local.set({ device });
    const data = await skipPost('/api/validate-key', m.key, device, { deviceId: device });
    if (!data.valid) throw new Error('SkipEdu отклонил ключ.');
    await browser.storage.local.set({ skipKey: m.key });
    return true;
  }
  if (tab == null) throw new Error('Вкладка недоступна.');
  switch (m.op) {
    case 'settings':
      await browser.tabs.create({ url: optionsUrl + '?course=' + encodeURIComponent(m.course || '') });
      return true;
    case 'poly': {
      const response = await fetch(polyUrl(m.url), { credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error('PolyVSP · HTTP ' + response.status);
      return response.text();
    }
    case 'search': {
      const { skipKey, device } = await browser.storage.local.get(['skipKey', 'device']);
      if (!skipKey) return { results: [], notice: 'Подключите SkipEdu в настройках.' };
      const open = isOpen(sender.url);
      const results = [];
      for (let offset = 0; offset < m.items.length; offset += 50) {
        const items = m.items.slice(offset, offset + 50);
        const payload = open ? {
          questions: items.map(i => i.q), choices: items.map(i => i.choices.slice(0, 12).map(c => c.slice(0, 300))),
          course: m.course ? 'course-v1:' + m.course : '',
          qmeta: items.map(i => ({ full: i.full?.slice(0,4000) || '', type: ['radio','checkbox'].includes(i.kind) ? 'choice' : i.kind, multi: i.kind === 'checkbox' }))
        } : { host: new URL(sender.url).host, attempt: new URL(sender.url).searchParams.get('attempt') || '', items, phone: false };
        const data = await skipPost(open ? '/api/kb/search-batch' : '/api/moodle/search', skipKey, device, payload);
        for (const r of data.results || []) {
          if (Number.isInteger(r.index) && r.index >= 0 && r.index < items.length) results[offset + r.index] = r;
        }
      }
      return { results };
    }
    case 'scan': {
      if (sender.frameId !== 0) throw new Error('Откройте панель на странице курса.');
      const frames = isOpen(sender.url) ? await browser.webNavigation.getAllFrames({ tabId: tab }) : [{ frameId: 0 }];
      const reports = await Promise.all(frames.filter(f => f.frameId === 0 || isOpen(f.url)).map(async f => {
        try {
          const report = await toFrame(tab, f.frameId, { op: 'scan', course: m.course, refresh: m.refresh });
          return report && { ...report, frameId: f.frameId };
        } catch { return null; } // A frame can navigate while its answers are loading.
      }));
      return reports.filter(Boolean);
    }
    case 'apply':
      if (sender.frameId !== 0) throw new Error('Откройте панель на странице курса.');
      return toFrame(tab, m.frameId, { op: 'apply', token: m.token, choices: m.choices, onlyEmpty: m.onlyEmpty });
    case 'changed':
      return toFrame(tab, 0, { op: 'changed' });
    default: throw new Error('Неизвестная команда SyncShare.');
  }
}

browser.runtime.onMessage.addListener((m, sender) => {
  if (m?.channel === 'syncshare') return handle(m, sender).then(value => ({ value }), e => ({ error: e.message }));
});
