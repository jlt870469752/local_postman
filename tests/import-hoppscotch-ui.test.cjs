const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = path.resolve(__dirname, '..');
const clone = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));
const flush = async () => { for (let i = 0; i < 4; i++) await tick(); };
const row = (key, value, active = true) => ({ key, value, active, description: 'Imported description' });
const request = (name, extra = {}) => ({
  v: '17', name, method: 'POST', endpoint: '<<base>>/submit', params: [], headers: [],
  auth: { authType: 'none', authActive: true }, body: { contentType: null, body: null },
  requestVariables: [], preRequestScript: '', testScript: '', responses: {}, description: null,
  ...extra,
});
const collection = (name, extra = {}) => ({
  v: 12, name, folders: [], requests: [], variables: [], headers: [],
  auth: { authType: 'inherit', authActive: true }, preRequestScript: '', testScript: '',
  description: null, ...extra,
});

const fixture = () => collection('Portable APIs', {
  variables: [row('base', 'https://example.test')],
  folders: [collection('Outer', {
    folders: [collection('Inner', {
      variables: [row('local', 'folder-value')],
      requests: [request('Create JSON', {
        endpoint: '<<base>>/users',
        params: [row('tag', 'first'), row('tag', 'disabled', false), row('item', '<<local>>')],
        headers: [row('Accept', 'application/json'), row('X-Disabled', 'never-send', false)],
        requestVariables: [row('local', 'request-value')],
        body: { contentType: 'application/json', body: '{"value":"<<local>>","literal":"a+b%20c"}' },
      })],
    })],
  })],
  requests: [
    request('Raw encoded form', {
      body: { contentType: 'application/x-www-form-urlencoded', body: 'value=a%2Bb&repeated=one&repeated=two' },
    }),
    request('Raw multiline form', {
      body: { contentType: 'application/x-www-form-urlencoded', body: 'first: one\nsecond: {"nested": "kept"}' },
    }),
    request('Multipart', {
      body: { contentType: 'multipart/form-data', body: [
        { key: 'value', value: '<<base>>', active: true, isFile: false },
        { key: 'value', value: 'second', active: true, isFile: false },
        { key: 'ignored', value: 'disabled', active: false, isFile: false },
      ] },
    }),
  ],
});

async function harness() {
  const errors = [], sent = [], vc = new VirtualConsole();
  vc.on('jsdomError', error => errors.push(error.message));
  const dom = new JSDOM('<div id="app"></div>', { url: 'http://localhost/', runScripts: 'outside-only', virtualConsole: vc });
  const w = dom.window; w.TextEncoder = TextEncoder;
  let saved;
  w.testInvoke = async (command, args) => {
    if (command === 'load_workspace') return { collections: [], environments: [], history: [] };
    if (command === 'save_workspace') { saved = clone(args.workspace); return; }
    if (command === 'git_status') return 'main';
    if (command === 'service_status' || command === 'mock_status') return [];
    if (command === 'send_request') {
      sent.push(clone(args.request));
      return { ok: true, status: 200, time_ms: 1, body: '{}', headers: {}, size: 2 };
    }
    throw Error('Unexpected invoke: ' + command);
  };
  const modules = ['src/assets/postman-icons.js', 'src/import-request.js', 'src/import-collection.js', 'src/code-snippets.js']
    .map(file => fs.readFileSync(path.join(root, file), 'utf8').replace(/^export /gm, '')).join('\n');
  w.eval('const invoke=window.testInvoke;\n' + modules + '\n' + fs.readFileSync(path.join(root, 'src/app.js'), 'utf8').replace(/^import .*;\s*$/gm, ''));
  await flush();
  const $ = selector => w.document.querySelector(selector);
  const click = selector => { assert.ok($(selector), 'Missing control: ' + selector); $(selector).click(); };
  const fill = (selector, value) => { const el = $(selector); assert.ok(el, selector); el.value = value; el.dispatchEvent(new w.Event('input', { bubbles: true })); };
  const paste = async data => { click('#importWorkspace'); fill('#importText', JSON.stringify(data)); click('#confirmImport'); await flush(); };
  const send = async id => {
    const collection = saved.collections.find(collection => collection.items.some(request => request.id === id));
    const request = collection.items.find(request => request.id === id), path = [];
    let folder = collection.folders.find(folder => folder.id === request.folderId);
    while (folder) { path.unshift(folder.id); folder = collection.folders.find(parent => parent.id === folder.parentId); }
    for (const folderId of path) if ($(`[data-toggle-folder="${folderId}"]`).getAttribute('aria-expanded') === 'false') click(`[data-toggle-folder="${folderId}"]`);
    click(`[data-open-request="${id}"]`); click('#send'); await flush(); return sent.at(-1);
  };
  return { w, $, click, fill, paste, send, sent, saved: () => clone(saved), dispose: () => { assert.deepEqual(errors, []); w.close(); } };
}

test('Hoppscotch pasted collections preserve folders, disabled rows, variables and sent bodies', async () => {
  const h = await harness();
  try {
    const source = fixture(), before = JSON.stringify(source);
    await h.paste(source);
    assert.equal(h.$('.import-modal'), null, h.$('.import-error')?.textContent);
    assert.equal(JSON.stringify(source), before);
    const imported = h.saved().collections[0];
    assert.equal(imported.name, source.name);
    assert.equal(imported.folders.length, 2);
    assert.equal(imported.items.length, 4);
    const outer = imported.folders.find(folder => folder.name === 'Outer');
    const inner = imported.folders.find(folder => folder.name === 'Inner');
    assert.equal(inner.parentId, outer.id);
    const json = imported.items.find(item => item.name === 'Create JSON');
    assert.equal(json.folderId, inner.id);
    assert.equal(json.url, '{{base}}/users');
    assert.equal(json.bodyType, 'raw');
    assert.equal(json.rawFormat, 'JSON');
    assert.equal(json.body, '{"value":"{{local}}","literal":"a+b%20c"}');
    assert.equal(json.params[1].enabled, false);
    assert.equal(json.params[1].description, 'Imported description');
    assert.equal(json.headers.find(header => header.key === 'X-Disabled').enabled, false);
    assert.equal(json.variables.find(variable => variable.key === 'local').value, 'request-value');

    const jsonSend = await h.send(json.id);
    assert.equal(jsonSend.url, 'https://example.test/users?tag=first&item=request-value');
    assert.equal(jsonSend.body, '{"value":"request-value","literal":"a+b%20c"}');
    assert.equal(jsonSend.headers.some(([key]) => key === 'X-Disabled'), false);
    assert.ok(jsonSend.headers.some(([key, value]) => key.toLowerCase() === 'content-type' && value === 'application/json'));

    for (const name of ['Raw encoded form', 'Raw multiline form']) {
      const raw = imported.items.find(item => item.name === name);
      const original = source.requests.find(item => item.name === name).body.body;
      assert.equal(raw.bodyType, 'raw');
      assert.equal(raw.rawFormat, 'Text');
      assert.equal(raw.body, original, 'Encoded text must not be parsed and reserialized');
      const sent = await h.send(raw.id);
      assert.equal(sent.body, original);
      assert.ok(sent.headers.some(([key, value]) => key.toLowerCase() === 'content-type' && value === 'application/x-www-form-urlencoded'));
    }

    const multipart = imported.items.find(item => item.name === 'Multipart');
    assert.equal(multipart.bodyType, 'form-data');
    assert.equal(multipart.bodyFields[2].enabled, false);
    const multipartSend = await h.send(multipart.id);
    assert.deepEqual(multipartSend.fields, [['value', 'https://example.test'], ['value', 'second']]);
    assert.equal(multipartSend.body_type, 'form-data');
  } finally { h.dispose(); }
});

test('Hoppscotch file imports create independent IDs and reject bad nested data atomically', async () => {
  const h = await harness();
  try {
    const source = fixture();
    await h.paste(source);
    assert.equal(h.$('.import-modal'), null, h.$('.import-error')?.textContent);
    h.click('#importWorkspace');
    const file = h.$('#importFile');
    Object.defineProperty(file, 'files', { value: [{ text: async () => '\uFEFF' + JSON.stringify(source) }] });
    await file.onchange({ target: file });
    await flush();
    assert.equal(h.$('.import-modal'), null);
    const saved = h.saved();
    assert.equal(saved.collections.length, 2);
    const ids = item => [item.id, ...item.folders.map(folder => folder.id), ...item.items.map(request => request.id)];
    const oldIds = new Set(ids(saved.collections[0]));
    assert.ok(ids(saved.collections[1]).every(id => !oldIds.has(id)));
    const bad = fixture(); bad.folders[0].folders[0].requests.push(null);
    await h.paste(bad);
    assert.ok(h.$('.import-error').textContent.trim());
    assert.equal(h.saved().collections.length, 2, 'Rejected documents must not partially import collections');
    h.click('#cancelImport');
    await flush();
  } finally { h.dispose(); }
});
