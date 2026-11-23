const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

test('selecting subjects preserves legacy URLs and binds them to the current OpenEdu course', async () => {
  const dom = new JSDOM(fs.readFileSync('dist/options.html', 'utf8'), {
    url: 'https://extension.test/options.html?course=A%2BB%2BC', runScripts: 'outside-only'
  });
  const w = dom.window;
  const storage = { 'poly:A+B+C': ['https://polyvsp.ru/legacy/'], 'poly:*': ['https://polyvsp.ru/default/'] };
  const byId = id => w.document.getElementById(id);
  const tick = () => new Promise(resolve => setImmediate(resolve));
  let offline = false;
  w.fetch = async () => {
    if (offline) throw new Error('offline');
    return { ok: true, text: async () => '<h2><a href="/eco/">Экология</a></h2><h2><a href="/math/">Математика</a></h2><h2><a href="https://example.org/private/">Посторонняя ссылка</a></h2>' };
  };
  w.browser = Object.assign(new w.Object(), {
    tabs: { query: async () => [] },
    storage: { local: {
      get: async keys => Object.fromEntries([].concat(keys).map(k => [k, storage[k]])),
      set: async values => Object.assign(storage, values)
    } }
  });
  try {
    w.eval(fs.readFileSync('dist/src/options.js','utf8'));
    await tick();
    assert.equal(byId('course').value, 'A+B+C');
    assert.equal(byId('course-list').querySelectorAll('input').length, 3);
    byId('course-search').value = 'ЭКОЛ';
    byId('course-search').dispatchEvent(new w.Event('input'));
    const options = byId('course-list').querySelectorAll('input');
    assert.equal(options.length, 1);
    options[0].click();
    byId('poly').dispatchEvent(new w.Event('submit', { cancelable: true }));
    await tick();
    assert.deepEqual(Array.from(storage['poly:A+B+C']), ['https://polyvsp.ru/legacy/', 'https://polyvsp.ru/eco/']);
    assert.deepEqual(storage['poly:*'], ['https://polyvsp.ru/default/']);
    offline = true;
    byId('reload-catalog').click();
    await tick();
    assert.match(byId('catalog-status').textContent, /сохранённый список/);
    assert.equal(byId('course-list').querySelector('input').checked, true);
  } finally { w.close(); }
});
