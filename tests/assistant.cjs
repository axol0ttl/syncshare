// Exercise the production bundles with extension messaging, detached documents and two simulated providers.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const bundle = name => fs.readFileSync('dist/src/' + name + '.js', 'utf8');
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(condition) {
  for (let i = 0; i < 100; i++) { if (condition()) return; await wait(10); }
  assert.ok(condition(), 'Timed out waiting for the panel');
}

function extension(storage, network) {
  const pages = new Map();
  const changes = [];
  function context(name, url, html, id) {
    const dom = new JSDOM(html, { url, runScripts:'outside-only' });
    if (id > 0) dom.reconfigure({ windowTop:pages.get(0).w });
    const w = dom.window;
    w.CSS = { escape: s => s };
    w.fetch = network;
    w.AbortSignal.timeout = AbortSignal.timeout;
    let root;
    const attach = w.Element.prototype.attachShadow;
    w.Element.prototype.attachShadow = function(opts) { root = attach.call(this, opts); return root; };
    const listeners = [];
    const sender = { url, frameId:id, tab:{ id:1 } };
    const deliver = (message, from) => {
      for (const fn of listeners) {
        const result = fn(structuredClone(message), from);
        if (result !== undefined) return Promise.resolve(result);
      }
      return Promise.resolve();
    };
    w.browser = Object.assign(new w.Object(), {
      runtime: {
        getURL: path => 'chrome-extension://test/' + path, getManifest: () => ({ name:'SyncShare',version:'1.0' }),
        onMessage:{ addListener: f => listeners.push(f) }, sendMessage: msg => background.deliver(msg, sender)
      },
      tabs:{ sendMessage: (_, msg, target) => pages.get(target.frameId).deliver(msg), query: async () => [{ url }] },
      storage:{ local:{
        get: async keys => Object.fromEntries([].concat(keys).filter(k => k in storage).map(k => [k, storage[k]])),
        set: async data => {
          Object.assign(storage, data);
          const change = Object.fromEntries(Object.entries(data).map(([k,v]) => [k, { newValue:v }]));
          changes.forEach(fn => fn(change, 'local'));
        }
      }, onChanged:{ addListener: f => changes.push(f) } },
      webNavigation:{ getAllFrames: async () => [...pages.values()].map(p => ({ frameId:p.id,url:p.url })) }
    });
    const page = { id, url, w, deliver, get root(){return root;}, start:() => w.eval(bundle(name)) };
    if (id != null) pages.set(id, page);
    return page;
  }
  const background = context('background','https://background.invalid','',null);
  background.start();
  return (url, html, frameId = 0) => {
    const p = context('assistant', url, html, frameId);
    p.start();
    return p;
  };
}
const ok = data => Promise.resolve({ ok:true, json:async () => data });
const textField = (id, question, value='') => '<div class="wrapper-problem-response"><label class="problem-group-label">' +
  question + '</label><input type="text" id="' + id + '" value="' + value + '"></div>';

test('OpenEdu asks once, remembers both sources, fills blanks and allows an explicit alternative', async () => {
  const storage = { skipKey:'key', device:'device', 'poly:A+B+C':['https://polyvsp.ru/course/'] };
  const html = textField('answer','What is the capital of France?') + textField('mine','What is the capital of Spain?', 'Madrid');
  const page = extension(storage, (url, req) => {
    if (url.includes('polyvsp.ru')) return { ok:true, text:async () => '<table><tr><td>What is the capital of France?</td><td>Paris</td></tr></table>' };
    const body = JSON.parse(req.body);
    assert.equal(body.course,'course-v1:A+B+C');
    return ok({ results:[{ index:0, found:true, answer:'Lyon', confidence:'exact' }] });
  });
  const p = page('https://courses.openedu.ru/courses/course-v1:A+B+C/unit', html);
  const $ = s => p.root.querySelector(s);
  try {
    await until(() => $('.prompt button'));
    assert.equal($('section').hidden,false);
    assert.equal(p.w.document.querySelector('#answer').value,'');
    $('.primary').click();
    [...p.root.querySelectorAll('.prompt button')].find(b => b.textContent === 'PolyVSP').click();
    await until(() => p.w.document.querySelector('#answer').value === 'Paris' && !$('.option').disabled);
    assert.equal(storage.preference,'PolyVSP');
    assert.equal(p.w.document.querySelector('#mine').value,'Madrid');
    await until(() => !$('.link').disabled);
    $('details').open = true;
    [...p.root.querySelectorAll('details:first-child .option')].find(b => b.textContent.includes('Lyon')).click();
    await until(() => p.w.document.querySelector('#answer').value === 'Lyon');
    assert.equal(storage.preference,'PolyVSP');
    const next = page('https://courses.openedu.ru/courses/course-v1:A+B+C/next',html);
    try {
      await until(() => next.root.querySelector('summary b'));
      assert.equal(next.root.querySelector('summary b').textContent,'Paris');
      assert.equal(next.root.querySelector('.prompt').hidden,true);
    } finally { next.w.close(); }
  } finally { p.w.close(); }
});

test('Moodle fills ddwtos by group and actual choice value, preserves occupied gaps and never submits', async () => {
  const drops = [1,2,3,4].map((n,i) => '<span class="drop place'+n+' group'+(i<2?1:2)+'"></span>').join(' then ');
  const inputs = [1,2,3,4].map((n,i) => '<input type="hidden" class="placeinput place'+n+' group'+(i<2?1:2)+'" value="'+(i===1?2:0)+'">').join('');
  const words = '<span class="draghome unplaced group1 choice2">tired</span><span class="draghome unplaced group1 choice5">surprising</span><span class="draghome unplaced group2 choice7">bored</span>';
  const html = '<form><div class="que ddwtos"><div class="qtext">Complete: '+drops+'</div>'+inputs+words+'</div></form>';
  const page = extension({ skipKey:'key', device:'dev' }, (url, req) => {
    assert.ok(url.endsWith('/api/moodle/search'));
    const body = JSON.parse(req.body);
    assert.deepEqual(body.items[0].gaps.map(g => g.choices),[['tired','surprising'],['tired','surprising'],['bored'],['bored']]);
    return ok({ results:[{ index:0, found:true, gaps:[{select:1},{select:1},{select:0},{select:0}] }] });
  });
  const p = page('https://school.test/mod/quiz/attempt.php?attempt=2',html);
  // A small stand-in for the widget. Only its drop listener may change placeinput.
  let moving;
  for (const el of p.w.document.querySelectorAll('.drop, .draghome')) {
    el.getBoundingClientRect = () => ({ left:0, top:0, width:80, height:24 });
  }
  p.w.document.addEventListener('mousedown', e => { moving = e.target.closest('.draghome.unplaced'); });
  p.w.document.addEventListener('mouseup', e => {
    if (!moving || !e.target.matches('.drop')) return;
    const place = e.target.className.match(/place(\d+)/)[1];
    const choice = moving.className.match(/choice(\d+)/)[1];
    p.w.document.querySelector('input.place' + place).value = choice;
    moving.classList.remove('unplaced');
    moving.classList.add('placed', 'inplace' + place);
    moving = null;
  });
  let submits = 0, changes = 0;
  p.w.document.addEventListener('submit', () => submits++);
  p.w.document.addEventListener('change', () => changes++);
  try {
    await until(() => p.root.querySelectorAll('details').length === 4);
    p.root.querySelector('.primary').click();
    await until(() => p.w.document.querySelector('.placeinput.place3').value === '7');
    assert.deepEqual([...p.w.document.querySelectorAll('input')].map(i => i.value),['5','2','7','0']);
    assert.equal(submits,0);
    assert.equal(changes,2);
  } finally { p.w.close(); }
});

test('one top panel fills an OpenEdu subframe when SkipEdu is unavailable and rejects stale fields', async () => {
  const page = extension({ 'poly:A+B+C':['https://polyvsp.ru/course/'], skipKey:'key' }, url => {
    if (url.includes('polyvsp')) return { ok:true, text:async () => '<table><tr><td>Pick an ocean</td><td>Atlantic</td></tr></table>' };
    return Promise.reject(Error('offline'));
  });
  const p = page('https://apps.openedu.ru/learning/course/course-v1:A+B+C/unit','');
  const html = '<div class="wrapper-problem-response"><legend>Pick an ocean</legend>' +
    '<label><input type="radio" name="o">Atlantic</label><label><input type="radio" name="o">Pacific</label></div>';
  const f = page('https://courses.openedu.ru/xblock/quiz',html,7);
  try {
    await until(() => p.root.querySelector('details'));
    assert.equal(f.root,undefined);
    assert.match(p.root.querySelector('.notes').textContent,/offline/);
    const old = f.w.document.querySelector('input');
    const fresh = old.cloneNode();
    old.replaceWith(fresh);
    p.root.querySelector('.primary').click();
    await until(() => p.root.querySelector('.status').textContent.includes('Страница изменилась'));
    assert.equal(fresh.checked,false);
    p.root.querySelector('.primary').click();
    await until(() => fresh.checked);
  } finally { f.w.close(); p.w.close(); }
});
