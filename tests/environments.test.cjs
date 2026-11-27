const fs = require('node:fs');
const assert = require('node:assert/strict');
const test = require('node:test');
const { JSDOM, VirtualConsole } = require('jsdom');
const tick = () => new Promise(resolve => setImmediate(resolve));
const settle = async () => { for (let i = 0; i < 6; i++) await tick(); };
const fixture = () => ({
  collections: [{ id: 'collection', name: 'APIs', folders: [], items: [
    { id: 'request', name: 'Request', method: 'GET', url: 'http://example.test/', params: [], headers: [{ key: 'X-Token', value: '{{token}}', enabled: true }], body: '' },
  ] }],
  activeEnvironmentId: 'local',
  environments: [
    { id: 'local', name: 'Local', values: { baseUrl: 'http://localhost:3000', token: 'initial' }, currentValues: { baseUrl: 'http://localhost:3000', token: 'current' } },
    { id: 'qa', name: 'QA', values: { token: 'qa-initial' }, currentValues: { token: 'qa-current' } },
  ], history: [],
});
async function harness({ initial = fixture(), strictAuth = false } = {}) {
  const errors = [], calls = [], writes = [], vc = new VirtualConsole();
  vc.on('jsdomError', error => errors.push(error.message));
  const dom = new JSDOM('<div id="app"></div>', { url: 'http://localhost/', runScripts: 'outside-only', virtualConsole: vc });
  const w = dom.window; w.TextEncoder = TextEncoder;
  let persisted = structuredClone(initial), failSave = false;
  w.testInvoke = async (command, args = {}) => {
    calls.push({ command, args: structuredClone(args) });
    if (command === 'load_workspace') return structuredClone(persisted);
    if (command === 'save_workspace') {
      if (failSave) throw Error('disk full');
      if (strictAuth && args.workspace.collections.some(collection => collection.items.some(request => request.auth === null))) throw Error('WORKSPACE_INVALID: auth 必须是对象');
      persisted = structuredClone(args.workspace); writes.push(structuredClone(persisted)); return;
    }
    if (command === 'workspace_list') return [{ id: 'default', name: 'My Workspace', active: true }];
    if (command === 'git_status') return 'main';
    if (command === 'mock_status' || command === 'service_status') return [];
    if (command === 'send_request') return { status: 200, ok: true, time_ms: 1, body: '{}', headers: {}, size: 2 };
    throw Error('Unexpected invoke ' + command);
  };
  const modules = ['src/assets/postman-icons.js', 'src/import-request.js', 'src/import-collection.js', 'src/code-snippets.js']
    .map(file => fs.readFileSync(file, 'utf8').replace(/^export /gm, '')).join('\n');
  const source = fs.readFileSync('src/app.js', 'utf8').replace(/^import .*;\s*$/gm, '');
  w.eval('const invoke=window.testInvoke;\n' + modules + '\n' + source);
  await settle();
  const $ = selector => w.document.querySelector(selector);
  const all = selector => [...w.document.querySelectorAll(selector)];
  const click = selector => { assert.ok($(selector), 'Missing ' + selector); $(selector).click(); };
  const fill = (selector, value) => { assert.ok($(selector), 'Missing ' + selector); $(selector).value = value; $(selector).dispatchEvent(new w.Event('input', { bubbles: true })); };
  const environment = id => structuredClone(persisted.environments.find(item => item.id === id));
  const rowFor = key => all('[data-env-key]').findIndex(input => input.value === key);
  const close = async () => { await settle(); assert.deepEqual(errors, [], 'Environment handlers must not throw'); w.close(); };
  return { w, $, all, click, fill, writes, calls, environment, rowFor, close, failSave(value) { failSave = value; } };
}

test('Saving environments repairs legacy null request auth while retaining drafts, history and unsaved baselines', async () => {
  const initial = fixture(), request = initial.collections[0].items[0];
  request.auth = null;
  const baseline = { ...structuredClone(request), name: 'Original request' };
  const draft = { ...structuredClone(request), id: 'draft', name: 'Unsaved request' };
  initial.collections[0].items.push(draft);
  initial.history.push({ ...structuredClone(request), id: 'history' });
  initial.editorSession = { openRequestTabs: [request.id, draft.id], selectedRequestTab: request.id, requestBaselines: { [request.id]: baseline, [draft.id]: null } };
  const h = await harness({ initial, strictAuth: true });
  try {
    h.click('#envButton'); h.click('#addEnvVar');
    const index = h.all('[data-env-key]').length - 1;
    h.fill(`[data-env-key="${index}"]`, 'localketang');
    h.fill(`[data-env-value="${index}"]`, 'http://127.0.0.1:8000');
    h.fill(`[data-env-current="${index}"]`, 'http://127.0.0.1:8000');
    h.click('#saveEnv'); await settle();
    assert.equal(h.$('.env-modal'), null);
    assert.equal(h.environment('local').currentValues.localketang, 'http://127.0.0.1:8000');
    const saved = h.writes.at(-1);
    assert.deepEqual(saved.collections[0].items.map(item => item.auth), [{ type: 'No Auth' }, { type: 'No Auth' }]);
    assert.deepEqual(saved.history[0].auth, { type: 'No Auth' });
    assert.deepEqual(saved.editorSession.requestBaselines.request.auth, { type: 'No Auth' });
    assert.equal(saved.editorSession.requestBaselines.request.name, 'Original request');
    assert.equal(saved.editorSession.requestBaselines.draft, null, 'The unsaved request marker remains null');
    h.click('#envButton');
    assert.equal(h.$(`[data-env-current="${h.rowFor('localketang')}"]`).value, 'http://127.0.0.1:8000');
    h.click('#cancelEnv');
    assert.equal(initial.collections[0].items[0].auth, null, 'The loaded source fixture remains unchanged');
  } finally { await h.close(); }
});

test('An imported collection with unset inherited auth does not block the next environment save', async () => {
  const h = await harness({ strictAuth: true });
  try {
    h.click('#importWorkspace');
    h.fill('#importText', JSON.stringify({ name: 'Inherited auth APIs', folders: [], requests: [{ name: 'Imported request', endpoint: 'https://example.test', method: 'GET', auth: { authType: 'inherit', authActive: true }, body: { contentType: null, body: null } }], auth: { authType: 'inherit', authActive: true } }));
    h.click('#confirmImport'); await settle();
    assert.equal(h.$('.import-modal'), null);
    assert.deepEqual(h.writes.at(-1).collections[1].items[0].auth, { type: 'No Auth' });
    h.click('#envButton'); h.fill('#envName', 'Local after import'); h.click('#saveEnv'); await settle();
    assert.equal(h.$('.env-modal'), null);
    assert.equal(h.environment('local').name, 'Local after import');
  } finally { await h.close(); }
});

test('Sidebar New environment creates a separate empty draft without overwriting Local', async () => {
  const h = await harness();
  try {
    h.click('[data-section="Environments"]'); h.click('#openEnv');
    assert.equal(h.$('#envName').value, 'New Environment');
    assert.equal(h.all('[data-env-key]').filter(input => input.value).length, 0);
    h.fill('#envName', 'Staging'); h.fill('[data-env-key="0"]', 'host'); h.fill('[data-env-value="0"]', 'https://staging.test');
    h.click('#saveEnv'); await settle();
    assert.equal(h.$('.env-modal'), null);
    assert.equal(h.environment('local').name, 'Local');
    assert.equal(h.environment('local').currentValues.token, 'current');
    const created = h.writes.at(-1).environments.find(item => item.name === 'Staging');
    assert.ok(created); assert.notEqual(created.id, 'local'); assert.notEqual(created.id, 'qa');
    assert.equal(created.values.host, 'https://staging.test');
    assert.equal(h.$('#envSelect').value, created.id);
  } finally { await h.close(); }
});

test('An explicitly empty current value stays empty after save, reopen and request resolution', async () => {
  const h = await harness();
  try {
    h.click('#envButton'); const index = h.rowFor('token'); assert.ok(index >= 0);
    h.fill(`[data-env-current="${index}"]`, ''); h.click('#saveEnv'); await settle();
    assert.equal(h.environment('local').values.token, 'initial');
    assert.equal(h.environment('local').currentValues.token, '');
    h.click('#envButton'); assert.equal(h.$(`[data-env-current="${h.rowFor('token')}"]`).value, '');
    h.click('#cancelEnv'); h.click('#send'); await settle();
    const sent = h.calls.findLast(call => call.command === 'send_request').args.request;
    assert.equal(sent.headers.find(([key]) => key === 'X-Token')[1], '');
  } finally { await h.close(); }
});

test('Each Add variable creates another editable row and retains preceding row values', async () => {
  const h = await harness();
  try {
    h.click('#envButton'); h.click('#newEnv'); h.fill('#envName', 'Many rows');
    const before = h.all('[data-env-key]').length;
    for (let i = 0; i < 4; i++) h.click('#addEnvVar');
    assert.equal(h.all('[data-env-key]').length, before + 4, 'Blank rows must not collapse into a single object key');
    for (let i = 0; i < before + 4; i++) {
      h.fill(`[data-env-key="${i}"]`, 'variable' + i);
      h.fill(`[data-env-value="${i}"]`, 'initial ' + i);
      h.fill(`[data-env-current="${i}"]`, 'current ' + i);
    }
    h.click('#addEnvVar'); assert.equal(h.$('[data-env-current="0"]').value, 'current 0');
    h.click('#saveEnv'); await settle();
    const saved = h.writes.at(-1).environments.find(item => item.name === 'Many rows');
    assert.equal(Object.keys(saved.values).length, before + 4);
    assert.equal(saved.currentValues['variable' + (before + 3)], 'current ' + (before + 3));
  } finally { await h.close(); }
});

test('Switching the editor keeps each draft and Save all writes edited environments together', async () => {
  const h = await harness();
  try {
    h.click('#envButton'); h.fill('#envName', 'Local edited'); h.fill(`[data-env-current="${h.rowFor('token')}"]`, 'local edited token');
    h.click('[data-pick-env="qa"]'); h.fill('#envName', 'QA edited'); h.fill(`[data-env-current="${h.rowFor('token')}"]`, 'qa edited token');
    h.click('[data-pick-env="local"]');
    assert.equal(h.$('#envName').value, 'Local edited'); assert.equal(h.$(`[data-env-current="${h.rowFor('token')}"]`).value, 'local edited token');
    assert.match(h.$('#saveEnv').textContent, /Save all/i);
    const writesBefore = h.writes.length;
    h.click('#saveEnv'); await settle();
    assert.equal(h.writes.length, writesBefore + 1, 'A single snapshot contains all edited environments');
    assert.equal(h.environment('local').name, 'Local edited'); assert.equal(h.environment('local').currentValues.token, 'local edited token');
    assert.equal(h.environment('qa').name, 'QA edited'); assert.equal(h.environment('qa').currentValues.token, 'qa edited token');
  } finally { await h.close(); }
});

test('Unsaved new environments remain selectable during the edit session and Cancel discards all drafts', async () => {
  const h = await harness();
  try {
    h.click('#envButton'); h.fill('#envName', 'Should not save'); h.click('#newEnv'); h.fill('#envName', 'New draft');
    h.fill('[data-env-key="0"]', 'draftValue'); h.fill('[data-env-value="0"]', 'retained');
    h.click('[data-pick-env="qa"]');
    const newButton = h.all('[data-pick-env]').find(button => /New draft/.test(button.textContent));
    assert.ok(newButton, 'New environment appears alongside saved environments before saving');
    newButton.click(); assert.equal(h.$('#envName').value, 'New draft'); assert.equal(h.$('[data-env-value="0"]').value, 'retained');
    const writesBefore = h.writes.length; h.click('#cancelEnv'); await settle();
    assert.equal(h.writes.length, writesBefore); assert.equal(h.environment('local').name, 'Local');
    h.click('#envButton'); assert.equal(h.$('#envName').value, 'Local');
    assert.equal(h.all('[data-pick-env]').length, 2);
    h.fill('#envName', 'Escape draft'); h.w.document.dispatchEvent(new h.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(h.$('.env-modal'), null); h.click('#envButton'); assert.equal(h.$('#envName').value, 'Local');
  } finally { await h.close(); }
});

test('Saving failures retain all drafts for retry and leave stored environments untouched', async () => {
  const h = await harness();
  try {
    h.click('#envButton'); h.fill('#envName', 'Local retry'); h.click('[data-pick-env="qa"]'); h.fill('#envName', 'QA retry');
    h.failSave(true); h.click('#saveEnv'); await settle();
    assert.ok(h.$('.env-modal')); assert.match(h.w.document.body.textContent, /disk full/); assert.equal(h.$('#envName').value, 'QA retry');
    assert.equal(h.environment('local').name, 'Local'); assert.equal(h.environment('qa').name, 'QA');
    h.click('[data-pick-env="local"]'); assert.equal(h.$('#envName').value, 'Local retry');
    h.failSave(false); h.click('#saveEnv'); await settle();
    assert.equal(h.$('.env-modal'), null); assert.equal(h.environment('local').name, 'Local retry'); assert.equal(h.environment('qa').name, 'QA retry');
  } finally { await h.close(); }
});

test('Empty names and duplicate variable names are rejected without losing editor contents', async () => {
  const h = await harness();
  try {
    h.click('#envButton'); h.fill('#envName', '   '); let before = h.writes.length;
    h.click('#saveEnv'); await settle(); assert.ok(h.$('.env-modal')); assert.equal(h.writes.length, before); assert.match(h.w.document.body.textContent, /name|名称/i);
    h.fill('#envName', 'Local'); h.fill('[data-env-key="0"]', 'duplicate'); h.fill('[data-env-key="1"]', 'duplicate');
    before = h.writes.length; h.click('#saveEnv'); await settle();
    assert.ok(h.$('.env-modal')); assert.equal(h.writes.length, before); assert.match(h.w.document.body.textContent, /duplicate|unique|重复/i);
    assert.equal(h.$('[data-env-key="0"]').value, 'duplicate'); assert.equal(h.$('[data-env-key="1"]').value, 'duplicate');
  } finally { await h.close(); }
});

test('Removing a variable keeps remaining row values aligned and persists only on Save', async () => {
  const h = await harness();
  try {
    h.click('#envButton'); const before = h.writes.length;
    h.click('[data-remove-env-row="0"]');
    assert.equal(h.$('[data-env-key="0"]').value, 'token');
    assert.equal(h.$('[data-env-value="0"]').value, 'initial');
    assert.equal(h.$('[data-env-current="0"]').value, 'current');
    assert.equal(h.writes.length, before); assert.equal(h.environment('local').values.baseUrl, 'http://localhost:3000');
    h.click('#saveEnv'); await settle();
    assert.equal(h.environment('local').values.baseUrl, undefined);
    assert.equal(h.environment('local').currentValues.token, 'current');
  } finally { await h.close(); }
});

test('Environment deletion requires confirmation and preserves the active environment when persistence fails', async () => {
  const h = await harness();
  try {
    h.click('#envButton'); await settle();
    const writesBefore = h.writes.length;
    h.click('#deleteEnv');
    assert.ok(h.$('#confirmEnvDelete')); assert.equal(h.writes.length, writesBefore);
    h.click('#cancelEnvDelete'); assert.ok(h.$('#saveEnv')); assert.equal(h.environment('local').name, 'Local');
    h.click('#deleteEnv'); h.failSave(true); h.click('#confirmEnvDelete'); await settle();
    assert.match(h.w.document.body.textContent, /disk full/); assert.ok(h.$('#confirmEnvDelete'));
    assert.equal(h.environment('local').name, 'Local'); assert.equal(h.$('#envSelect').value, 'local');
    h.failSave(false); h.click('#confirmEnvDelete'); await settle();
    assert.equal(h.writes.length, writesBefore + 1); assert.equal(h.environment('local'), undefined);
    assert.equal(h.$('[data-pick-env="local"]'), null); assert.ok(h.$('[data-pick-env="qa"]'));
    assert.equal(h.$('#envSelect').value, '');
  } finally { await h.close(); }
});

test('Special property names survive environment persistence as own variables', async () => {
  const h = await harness();
  try {
    h.click('#envButton'); h.click('#newEnv'); h.fill('#envName', 'Special names');
    h.fill('[data-env-key="0"]', '__proto__'); h.fill('[data-env-value="0"]', 'literal value'); h.fill('[data-env-current="0"]', '');
    h.click('#saveEnv'); await settle();
    const saved = h.writes.at(-1).environments.find(item => item.name === 'Special names');
    assert.ok(Object.hasOwn(saved.values, '__proto__')); assert.equal(saved.values.__proto__, 'literal value');
    assert.ok(Object.hasOwn(saved.currentValues, '__proto__')); assert.equal(saved.currentValues.__proto__, '');
    h.click('#envButton'); assert.equal(h.$('[data-env-key="0"]').value, '__proto__'); assert.equal(h.$('[data-env-current="0"]').value, '');
  } finally { await h.close(); }
});
