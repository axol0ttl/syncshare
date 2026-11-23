import browser from 'webextension-polyfill';
export { browser };
export const send = (op, data = {}) => browser.runtime.sendMessage({ channel: 'syncshare', op, ...data })
  .then(r => {
    if (!r || r.error) throw new Error(r?.error || 'Расширение недоступно. Обновите страницу.');
    return r.value;
  });
export const sourceKey = course => 'poly:' + (course || '*');
export function polyUrl(raw) {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.hostname !== 'polyvsp.ru' || url.port || url.username || url.password)
    throw new Error('Укажите HTTPS-ссылку на страницу polyvsp.ru.');
  return url.origin + url.pathname;
}
