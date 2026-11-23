import { browser, send } from '../assistant/api';
import { courseKey } from '../assistant/openedu';

import { setupCatalog } from './catalog';

const el = id => document.getElementById(id);
const say = message => { el('status').textContent = message; };
function connection(connected) {
  el('connection').textContent = connected ? 'Подключено для OpenEdu и Moodle.' : 'Для поиска нужен ключ вашей учётной записи.';
  el('login').hidden = connected;
  el('disconnect').hidden = !connected;
}
async function init() {
  const s = await browser.storage.local.get(['preference', 'skipKey']);
  el('preference').value = s.preference || '';
  connection(!!s.skipKey);
  const params = new URLSearchParams(location.search);
  const [active] = await browser.tabs.query({ active: true, currentWindow: true });
  await setupCatalog(params.get('course') || courseKey(active?.url) || '');
}
el('login').onsubmit = async e => {
  e.preventDefault();
  const b = e.submitter;
  b.disabled = true;
  try {
    await send('login', { key: el('key').value.trim() });
    el('key').value = '';
    connection(true);
    say('SkipEdu подключён.');
  } catch (err) { say(err.message); }
  finally { b.disabled = false; }
};
el('disconnect').onclick = async () => {
  await browser.storage.local.remove('skipKey');
  connection(false);
  say('Ключ удалён из SyncShare.');
};
el('preference').onchange = async () => {
  await browser.storage.local.set({ preference: el('preference').value });
  say('Предпочтение сохранено.');
};
init().catch(err => say(err.message));
