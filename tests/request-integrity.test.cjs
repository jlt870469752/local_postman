const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { JSDOM, VirtualConsole } = require('jsdom');
const root = path.resolve(__dirname, '..');
const clone = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));
const flush = async () => { for (let i = 0; i < 4; i++) await tick(); };
const row = (key, value, extra = {}) => ({ key, value, enabled: true, description: '', ...extra });
const request = (id, extra = {}) => ({ id, name: id, method: 'GET', url: 'https://example.test/' + id, headers: [], params: [], body: '', bodyType: 'none', ...extra });
const workspace = (items = [request('A'), request('B')]) => ({ collections: [{ id: 'c', name: 'APIs', folders: [], items }], environments: [], history: [], mockServers: [] });
async function harness(data = workspace()) {
  const errors = [], pending = [], requests = [], vc = new VirtualConsole();
  vc.on('jsdomError', error => errors.push(error.message));
  const dom = new JSDOM('<div id="app"></div>', { url: 'http://localhost/', runScripts: 'outside-only', virtualConsole: vc });
  const w = dom.window; w.TextEncoder = TextEncoder;
  w.testInvoke = async (command, args) => {
    if (command === 'load_workspace') return clone(data);
    if (command === 'save_workspace') return;
    if (command === 'git_status') return 'main';
    if (command === 'mock_status' || command === 'service_status') return [];
    if (command === 'send_request') {
      requests.push(clone(args.request));
      return new Promise((resolve, reject) => pending.push({ resolve, reject }));
    }
    throw Error('Unexpected invoke: ' + command);
  };
  const modules = ['src/assets/postman-icons.js', 'src/import-request.js', 'src/import-collection.js', 'src/code-snippets.js']
    .map(file => fs.readFileSync(path.join(root, file), 'utf8').replace(/^export /gm, '')).join('\n');
  const source = fs.readFileSync(path.join(root, 'src/app.js'), 'utf8').replace(/^import .*;\s*$/gm, '');
  w.eval('const invoke=window.testInvoke;\n' + modules + '\n' + source + '\nwindow.testApp={snapshot:()=>JSON.parse(JSON.stringify(state)),snippet:snippetRequest,run:serviceRequests,send};');
  await flush();
  const $ = selector => w.document.querySelector(selector);
  const click = selector => { assert.ok($(selector), 'Missing control: ' + selector); $(selector).click(); };
  const fill = (selector, value) => { const el = $(selector); assert.ok(el, 'Missing field: ' + selector); el.value = value; el.dispatchEvent(new w.Event('input', { bubbles: true })); };
  const select = (selector, value) => { fill(selector, value); $(selector).dispatchEvent(new w.Event('change', { bubbles: true })); };
  const complete = (index, body) => pending[index].resolve({ ok: true, status: 200, time_ms: 3, body, headers: {}, size: body.length });
  const file = (name, read) => { Object.defineProperty($('#binaryFile'), 'files', { configurable: true, value: [{ name, arrayBuffer: read }] }); $('#binaryFile').dispatchEvent(new w.Event('change', { bubbles: true })); };
  const snapshot = () => clone(w.testApp.snapshot());
  const dispose = async () => { for (const item of pending) item.resolve({ ok: true, status: 200, time_ms: 1, body: '{}', headers: {} }); await flush(); assert.deepEqual(errors, [], 'UI handlers must not throw'); w.close(); };
  return { w, $, click, fill, select, complete, file, requests, pending, snapshot, dispose };
}

test('Responses stay with their request and background completion preserves the active editor', async () => {
  const h = await harness();
  try {
    h.click('#send'); assert.equal(h.$('#send').disabled, true); h.click('#send');
    await h.w.testApp.send(); assert.equal(h.requests.length, 1, 'A second send is ignored while pending');
    h.click('[data-open-request="B"]'); h.fill('#url', 'https://example.test/B-edited');
    const editor = h.$('#url'); h.complete(0, '{"from":"A"}'); await flush();
    assert.equal(h.$('#url'), editor, 'Background completion does not replace the focused editor');
    assert.equal(h.$('#url').value, 'https://example.test/B-edited'); assert.equal(h.$('.response-code'), null);
    h.click('[data-open-request="A"]'); assert.match(h.$('.response-code').textContent, /"from": "A"/);
    assert.equal(h.$('#send').disabled, false);
  } finally { await h.dispose(); }
});

test('Concurrent requests, errors and history use the immutable sent snapshot', async () => {
  const h = await harness();
  try {
    h.click('#send'); h.fill('#requestName', 'A edited after send'); h.fill('#url', 'https://example.test/A-after-send');
    h.click('[data-open-request="B"]'); h.click('#send'); h.fill('#url', 'https://example.test/B-after-send');
    h.complete(1, '{"from":"B"}'); await flush();
    assert.match(h.$('.response-code').textContent, /"from": "B"/); assert.equal(h.$('#url').value, 'https://example.test/B-after-send');
    h.complete(0, '{"from":"A"}'); await flush(); assert.match(h.$('.response-code').textContent, /"from": "B"/);
    const history = h.snapshot().history; assert.equal(history.find(r => r.name === 'A').url, 'https://example.test/A');
    assert.equal(history.find(r => r.name === 'B').url, 'https://example.test/B');
    h.click('[data-open-request="A"]'); assert.equal(h.$('#requestName').value, 'A edited after send');
    h.click('#send'); h.click('[data-open-request="B"]'); const editor = h.$('#url');
    h.pending[2].reject(Error('Connection refused')); await flush(); assert.equal(h.$('#url'), editor);
    assert.match(h.$('.response-code').textContent, /"from": "B"/);
    h.click('[data-open-request="A"]'); assert.match(h.$('.response-code').textContent, /Connection refused/);
  } finally { await h.dispose(); }
});

test('Binary file reads remain attached to their originating request and latest selection', async () => {
  const h = await harness(workspace([request('A', { bodyType: 'binary' }), request('B', { bodyType: 'binary' })]));
  let first, latest;
  try {
    h.click('[data-builder="Body"]'); h.file('old.bin', () => new Promise(resolve => first = resolve));
    h.file('latest.bin', () => new Promise(resolve => latest = resolve));
    h.click('[data-open-request="B"]'); const editor = h.$('#url');
    latest(Uint8Array.from([4, 5]).buffer); await flush(); first(Uint8Array.from([1, 2, 3]).buffer); await flush();
    const [a, b] = h.snapshot().collections[0].items;
    assert.equal(a.binaryName, 'latest.bin'); assert.deepEqual(a.binaryBytes, [4, 5]);
    assert.equal(b.binaryName, undefined); assert.equal(h.$('#url'), editor);
    h.click('[data-open-request="A"]'); assert.match(h.$('.binary-panel').textContent, /latest.bin/);
  } finally { if (first) first(new ArrayBuffer(0)); if (latest) latest(new ArrayBuffer(0)); await h.dispose(); }
});

test('Send, code snippets and collection runners share auth, headers, variables and body serialization', async () => {
  const data = workspace([request('A', {
    method: 'POST', url: '{{base}}/{{resource}}', folderId: 'f', bodyType: 'urlencoded',
    auth: { type: 'Bearer Token', token: 'generated-token' },
    params: [row('tag', 'one'), row('tag', 'two'), row('disabled', 'skip', { enabled: false })],
    headers: [row('authorization', 'Explicit auth'), row('X-Tag', 'a'), row('X-Tag', 'b'), row('Disabled', 'skip', { enabled: false })],
    bodyFields: [row('message', '{{message}}'), row('part', 'one'), row('part', 'two')],
  })]);
  data.collections[0].variables = [row('base', 'https://collection.test'), row('resource', 'collection')];
  data.collections[0].folders = [{ id: 'f', parentId: null, name: 'Folder', variables: [row('resource', 'folder')] }];
  data.environments = [{ id: 'env', name: 'Test', values: { message: 'initial', base: 'https://env.test' }, currentValues: { message: 'current & value' } }];
  data.activeEnvironmentId = 'env';
  const h = await harness(data);
  try {
    h.click('#codeSnippet'); const snippet = h.$('.snippet-source').textContent;
    assert.match(snippet, /authorization: Explicit auth/); assert.doesNotMatch(snippet, /generated-token/);
    assert.match(snippet, /X-Tag: a/); assert.match(snippet, /X-Tag: b/);
    const serialized = clone(h.w.testApp.snippet()); h.click('#send'); assert.deepEqual(h.requests[0], serialized);
    const config = { collectionId: 'c', environmentId: 'env', timeout: 5000, followRedirects: false, verifySsl: true };
    const runner = clone(h.w.testApp.run(config)[0]);
    assert.deepEqual(runner, { ...serialized, settings: { timeout: 5000, followRedirects: false, verifySsl: true } });
    assert.equal(serialized.url, 'https://env.test/folder?tag=one&tag=two');
    assert.equal(serialized.body, 'message=current+%26+value&part=one&part=two');
    assert.deepEqual(serialized.headers, [['authorization', 'Explicit auth'], ['X-Tag', 'a'], ['X-Tag', 'b'], ['Content-Type', 'application/x-www-form-urlencoded']]);
    h.complete(0, '{}'); await flush();
    const noEnvironment = clone(h.w.testApp.run({ ...config, environmentId: '' })[0]);
    assert.equal(noEnvironment.url, 'https://collection.test/folder?tag=one&tag=two');
    assert.match(noEnvironment.body, /%7B%7Bmessage%7D%7D/, 'No Environment does not borrow the active editor environment');
  } finally { await h.dispose(); }
});

test('Generated Basic and API Key auth are consistent and preserve explicit same-name headers', async () => {
  for (const auth of [{ type: 'Basic Auth', username: '用户', password: '密码' }, { type: 'API Key', key: 'X-Key', value: '{{key}}', location: 'header' }, { type: 'API Key', key: 'api_key', value: '{{key}}', location: 'query' }]) {
    const data = workspace([request('A', { auth, method: 'POST', bodyType: 'graphql', graphqlQuery: 'query { item(id: "{{key}}") }', graphqlVariables: '{"id":"{{key}}"}', headers: [row('x-key', 'explicit'), row('X-Repeat', '1'), row('X-Repeat', '2')] })]);
    data.environments = [{ id: 'e', name: 'Local', values: { key: 'value' } }]; data.activeEnvironmentId = 'e';
    const h = await harness(data);
    try {
      const snippet = clone(h.w.testApp.snippet()); h.click('#send'); assert.deepEqual(h.requests[0], snippet);
      assert.deepEqual(clone(h.w.testApp.run({ collectionId: 'c', environmentId: 'e' })[0]), { ...snippet, settings: {} });
      if (auth.type === 'Basic Auth') assert.ok(snippet.headers.some(([key, value]) => key === 'Authorization' && value === 'Basic ' + Buffer.from('用户:密码').toString('base64')));
      if (auth.location === 'header') assert.deepEqual(snippet.headers.filter(([key]) => key.toLowerCase() === 'x-key'), [['x-key', 'explicit']]);
      if (auth.location === 'query') assert.equal(new URL(snippet.url).searchParams.get('api_key'), 'value');
      assert.deepEqual(JSON.parse(snippet.body).variables, { id: 'value' }); h.complete(0, '{}'); await flush();
    } finally { await h.dispose(); }
  }
});

test('Bulk Edit round trips and reordered duplicate rows preserve descriptions and imported metadata', async () => {
  const data = workspace([request('A', {
    method: 'POST', bodyType: 'form-data', url: 'https://example.test/A?tag=one&tag=two',
    params: [row('tag', 'one', { description: 'first tag' }), row('tag', 'two', { description: 'second tag' })],
    headers: [row('X-Header', 'value', { description: 'header note' })],
    bodyFields: [row('upload', '/tmp/picture.png', { description: 'image note', type: 'file', src: ['/tmp/picture.png'], contentType: 'image/png' })],
  })]);
  const h = await harness(data);
  try {
    h.click('[data-bulk="param"]'); h.fill('[data-bulk-input="param"]', 'tag:two\ntag:one'); h.click('[data-bulk="param"]');
    assert.equal(h.$('[data-param-description="0"]').value, 'second tag'); assert.equal(h.$('[data-param-description="1"]').value, 'first tag');
    h.click('[data-builder="Headers"]'); h.click('[data-bulk="header"]'); h.fill('[data-bulk-input="header"]', 'X-Header:changed'); h.click('[data-bulk="header"]');
    assert.equal(h.$('[data-header-description="0"]').value, 'header note');
    h.click('[data-builder="Body"]'); h.click('[data-bulk="bodyfield"]'); h.click('[data-bulk="bodyfield"]');
    const r = h.snapshot().collections[0].items[0]; assert.equal(r.bodyFields[0].description, 'image note');
    assert.equal(r.bodyFields[0].type, 'file'); assert.deepEqual(r.bodyFields[0].src, ['/tmp/picture.png']); assert.equal(r.bodyFields[0].contentType, 'image/png');
  } finally { await h.dispose(); }
});

test('Changing a base URL preserves disabled query rows and existing enabled row descriptions', async () => {
  const data = workspace([request('A', { url: 'https://example.test/A?enabled=value', params: [row('enabled', 'value', { description: 'enabled note' }), row('disabled', 'keep', { enabled: false, description: 'disabled note' })] })]);
  const h = await harness(data);
  try {
    h.fill('#url', 'https://new.test/path?enabled=changed'); h.$('#url').dispatchEvent(new h.w.Event('change', { bubbles: true }));
    let params = h.snapshot().collections[0].items[0].params;
    assert.equal(params[0].description, 'enabled note'); assert.deepEqual(params[1], row('disabled', 'keep', { enabled: false, description: 'disabled note' }));
    h.fill('#url', 'https://new.test/base'); h.$('#url').dispatchEvent(new h.w.Event('change', { bubbles: true }));
    params = h.snapshot().collections[0].items[0].params;
    assert.deepEqual(params, [row('disabled', 'keep', { enabled: false, description: 'disabled note' })]);
  } finally { await h.dispose(); }
});
