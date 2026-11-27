const fs = require('node:fs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM, VirtualConsole } = require('jsdom');

const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };
const fixture = () => ({
  collections: [{ id: 'c', name: 'Collections', folders: [{ id: 'f', name: 'History', parentId: null }], items: [{
    id: 'r', name: 'Settings', folderId: 'f', method: 'POST', url: 'http://example.test/{{endpoint}}',
    params: [], headers: [{ key: 'Send', value: 'History', enabled: true, description: 'Settings' }],
    body: 'Send', bodyType: 'raw', rawFormat: 'Text', auth: { type: 'Basic Auth', username: 'Save', password: 'Settings' },
  }] }],
  activeEnvironmentId: 'e', environments: [{ id: 'e', name: 'General', values: { endpoint: 'Save', Settings: 'Send' }, currentValues: { endpoint: 'Save' } }],
  history: [{ id: 'h', name: 'History', method: 'GET', url: 'http://example.test/Save', at: 1 }],
});

async function harness({ preferences = {}, workspace = fixture() } = {}) {
  const errors = [], calls = [], vc = new VirtualConsole();
  vc.on('jsdomError', error => errors.push(error.message));
  const dom = new JSDOM('<div id="app"></div>', { url: 'http://localhost/', runScripts: 'outside-only', virtualConsole: vc });
  const w = dom.window;
  w.TextEncoder = TextEncoder;
  w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  let savedPreferences = structuredClone(preferences), savedWorkspace = structuredClone(workspace);
  w.testInvoke = async (command, args = {}) => {
    calls.push({ command, args: structuredClone(args) });
    if (command === 'load_workspace') return structuredClone(savedWorkspace);
    if (command === 'save_workspace') { savedWorkspace = structuredClone(args.workspace); return; }
    if (command === 'workspace_list') return [{ id: 'default', name: 'Settings', active: true }, { id: 'other', name: 'History', active: false }];
    if (command === 'settings_load') return structuredClone(savedPreferences);
    if (command === 'settings_save') { savedPreferences = structuredClone(args.settings); return savedPreferences; }
    if (command === 'settings_info') return { version: '0.2.0', platform: 'macos', arch: 'arm64', dataDirectory: '/tmp/Settings', preferencesPath: '/tmp/Settings/preferences.json' };
    if (command === 'git_status') return 'main';
    if (command === 'mock_status' || command === 'service_status') return [];
    if (command === 'send_request') return { ok: true, status: 200, headers: { Settings: 'Save' }, body: 'History', size: 7, time_ms: 1 };
    throw Error('Unexpected invoke: ' + command);
  };
  const language = fs.readFileSync('src/i18n.js', 'utf8').replace(/^export /gm, '');
  w.eval('(()=>{' + language + '\nObject.assign(window,{setLanguage,translateUi,observeUi});})();');
  const settings = fs.readFileSync('src/settings-panel.js', 'utf8').replace(/^import .*;\s*$/gm, '').replace(/^export /gm, '');
  w.eval('(()=>{' + settings + '\nObject.assign(window,{createSettingsPanel,defaultSettings});})();');
  const modules = ['src/assets/postman-icons.js', 'src/import-request.js', 'src/import-collection.js', 'src/code-snippets.js']
    .map(file => fs.readFileSync(file, 'utf8').replace(/^export /gm, '')).join('\n');
  const source = fs.readFileSync('src/app.js', 'utf8').replace(/^import .*;\s*$/gm, '');
  w.eval('const invoke=window.testInvoke;const createSettingsPanel=window.createSettingsPanel,defaultSettings=window.defaultSettings;\n' + modules + '\n' + source + '\nwindow.testPanel=settingsPanel;');
  await settle(); await w.testPanel.ready; await settle();
  const $ = selector => w.document.querySelector(selector);
  const click = selector => { assert.ok($(selector), 'Missing ' + selector); $(selector).click(); };
  const fill = (selector, value, event = 'input') => { assert.ok($(selector), 'Missing ' + selector); $(selector).value = value; $(selector).dispatchEvent(new w.Event(event, { bubbles: true })); };
  const chooseLanguage = async code => { click('#appSettings'); await settle(); click(`[data-preference="general.language"][value="${code}"]`); await w.testPanel.flush(); await settle(); click('#settingsClose'); await settle(); };
  return { w, $, click, fill, calls, chooseLanguage,
    preferences: () => structuredClone(savedPreferences), workspace: () => structuredClone(savedWorkspace),
    async close() { await w.testPanel.close(); await settle(); assert.deepEqual(errors, [], 'Localized app controls must not throw'); w.close(); },
  };
}

test('Language selection translates application controls immediately and is restored on the next launch', async () => {
  const h = await harness();
  let saved;
  try {
    assert.equal(h.$('#send').textContent, 'Send');
    await h.chooseLanguage('zh-CN');
    assert.equal(h.w.document.documentElement.lang, 'zh-CN');
    assert.equal(h.$('#send').textContent, '发送');
    assert.equal(h.$('[data-builder="Body"]').textContent, '请求体');
    assert.equal(h.$('#envSelect option[value=""]').textContent, '未选择环境');
    assert.equal(h.$('#appSettings').getAttribute('aria-label'), '设置');
    saved = h.preferences(); assert.equal(saved.general.language, 'zh-CN');
  } finally { await h.close(); }
  const reopened = await harness({ preferences: saved });
  try {
    assert.equal(reopened.$('#send').textContent, '发送');
    await reopened.chooseLanguage('en');
    assert.equal(reopened.w.document.documentElement.lang, 'en');
    assert.equal(reopened.$('#send').textContent, 'Send');
    assert.equal(reopened.$('[data-builder="Body"]').textContent, 'Body');
    assert.equal(reopened.preferences().general.language, 'en');
  } finally { await reopened.close(); }
});

test('User collection, folder, request, environment, history and workspace names remain unchanged in Chinese', async () => {
  const h = await harness({ preferences: { general: { language: 'zh-CN' } } });
  try {
    assert.equal(h.$('.collection-head strong').textContent, 'Collections');
    assert.equal(h.$('[data-toggle-folder="f"] .tree-label').textContent, 'History');
    h.click('[data-toggle-folder="f"]');
    assert.equal(h.$('[data-open-request="r"] .tree-label').textContent, 'Settings');
    assert.equal(h.$('.tab-title').textContent, 'Settings');
    assert.equal(h.$('#requestName').value, 'Settings');
    assert.match(h.$('.crumbs').textContent, /Collections/);
    assert.equal(h.$('#envSelect option[value="e"]').textContent, 'General');
    h.click('[data-section="Environments"]'); await settle();
    assert.equal(h.$('[data-edit-env="e"]').textContent.trim(), 'General');
    h.click('#save'); await settle();
    assert.equal(h.$('[data-save-collection="c"] span').textContent, 'Collections');
    assert.equal(h.$('[data-save-folder="c:f"] span').textContent, 'History');
    h.click('#cancelSave');
    h.click('[data-view="history"]'); await settle();
    assert.equal(h.$('[data-history="h"] span:not(.tree-method)').textContent, 'History');
    h.click('#workspaceMenu'); await settle();
    const option = h.$('[data-switch-workspace="default"]');
    assert.equal(option.querySelector('span:nth-child(2)').firstChild.textContent, 'Settings');
    const localLabel = option.querySelector('small'); assert.equal(localLabel.textContent, '本地工作区');
  } finally { await h.close(); }
});

test('Translated auth and raw-format labels retain request enum values and preserve the sent payload', async () => {
  const h = await harness({ preferences: { general: { language: 'zh-CN' } } });
  try {
    h.click('[data-builder="Body"]');
    assert.equal(h.$('#body').value, 'Send');
    assert.equal(h.$('#rawFormat').value, 'Text');
    assert.equal([...h.$('#rawFormat').options].find(option => option.value === 'Text').textContent, '文本');
    h.click('[data-builder="Authorization"]');
    assert.equal(h.$('#authType').value, 'Basic Auth');
    assert.equal(h.$('#authType option[value="No Auth"]').textContent, '无授权');
    assert.equal(h.$('[data-auth="username"]').value, 'Save');
    h.click('#send'); await settle();
    const sent = h.calls.findLast(call => call.command === 'send_request').args.request;
    assert.equal(sent.method, 'POST'); assert.equal(sent.url, 'http://example.test/Save');
    assert.equal(sent.body, 'Send'); assert.equal(sent.body_type, 'raw');
    assert.ok(sent.headers.some(([key, value]) => key === 'Send' && value === 'History'));
    assert.ok(sent.headers.some(([key, value]) => key === 'Authorization' && value === 'Basic ' + Buffer.from('Save:Settings').toString('base64')));
    assert.equal(h.$('.response-code').textContent, 'History');
    h.click('[data-response-view="Headers"]');
    assert.equal(h.$('.response-headers strong').textContent, 'Settings');
    assert.equal(h.$('.response-headers span').textContent, 'Save');
  } finally { await h.close(); }
});

test('Language changes do not replace the active body editor, selection or event handlers', async () => {
  const h = await harness();
  try {
    h.click('[data-builder="Body"]');
    const body = h.$('#body'); body.focus(); body.setSelectionRange(1, 3);
    h.w.setLanguage('zh-CN'); await settle();
    assert.equal(h.$('#body'), body); assert.equal(h.w.document.activeElement, body);
    assert.equal(body.selectionStart, 1); assert.equal(body.selectionEnd, 3); assert.equal(body.value, 'Send');
    h.w.setLanguage('en'); await settle();
    assert.equal(h.$('#body'), body); assert.equal(body.selectionStart, 1); assert.equal(body.selectionEnd, 3);
    await h.chooseLanguage('zh-CN');
    assert.equal(h.$('#body'), body, 'Saving a language preference must preserve the current request editor');
    assert.equal(body.selectionStart, 1); assert.equal(body.selectionEnd, 3);
    assert.equal(h.$('[data-select-tab="r"]').classList.contains('is-dirty'), false, 'Translating controls must not create unsaved request changes');
    h.fill('#body', 'Settings'); h.click('#send'); await settle();
    assert.equal(h.calls.findLast(call => call.command === 'send_request').args.request.body, 'Settings');
  } finally { await h.close(); }
});

test('Mock routes and service configuration labels translate while names and response data stay verbatim', async () => {
  const workspace = fixture();
  workspace.mockServers = [{ id: 'm', name: 'Settings', collectionId: 'c', port: 0, routes: [{ id: 'route', name: 'History', method: 'GET', path: '/Save', status: 200, headers: { Settings: 'Save' }, body: 'Send' }] }];
  workspace.monitors = [{ id: 'monitor', name: 'General', collectionId: 'c', environmentId: 'e', schedule: 'manual', intervalMinutes: 60, time: '18:00', timeout: 30000, delay: 0, followRedirects: true, verifySsl: true }];
  const h = await harness({ preferences: { general: { language: 'zh-CN' } }, workspace });
  try {
    h.click('[data-view="services"]'); await settle();
    assert.equal(h.$('[data-mock-select="m"]>span').firstChild.textContent, 'Settings');
    h.click('[data-mock-select="m"]'); await settle();
    assert.equal(h.$('#mockName').value, 'Settings');
    assert.equal(h.$('#mockCollection option[value="c"]').textContent, 'Collections');
    assert.equal(h.$('.mock-route-item strong').textContent, 'History');
    assert.equal(h.$('.mock-route-heading strong').textContent, 'History');
    assert.equal(h.$('#mockBody').value, 'Send');
    assert.deepEqual(JSON.parse(h.$('#mockHeaders').value), { Settings: 'Save' });
    h.click('[data-service-toggle="monitors"]'); await settle();
    assert.equal(h.$('[data-service-open="monitors:monitor"]>span').textContent, 'General');
    h.click('[data-service-open="monitors:monitor"]'); await settle();
    assert.equal(h.$('#serviceName').value, 'General');
    assert.equal(h.$('#serviceCollection option[value="c"]').textContent, 'Collections');
    assert.equal(h.$('#serviceEnvironment option[value="e"]').textContent, 'General');
    assert.equal(h.$('#serviceEnvironment option[value=""]').textContent, '未选择环境');
    assert.equal(h.$('#serviceSchedule').value, 'manual');
  } finally { await h.close(); }
});


test('Deletion confirmations and binary filenames preserve user text equal to translated UI labels', async () => {
  const workspace = fixture();
  Object.assign(workspace.collections[0].items[0], { bodyType: 'binary', binaryName: 'Settings', binaryBytes: [1, 2, 3] });
  const h = await harness({ preferences: { general: { language: 'zh-CN' } }, workspace });
  try {
    h.click('[data-builder="Body"]');
    assert.equal(h.$('.binary-panel > span').textContent, 'Settings');
    assert.equal(h.$('.binary-panel .file-picker').firstChild.textContent, '选择文件');
    for (const [kind, id, name] of [['collection', 'c', 'Collections'], ['folder', 'f', 'History'], ['request', 'r', 'Settings']]) {
      h.w.eval(`openEntityDialog('delete', '${kind}', 'c', '${id}')`); await settle();
      assert.equal(h.$('.entity-fields p strong').textContent, name);
      assert.equal(h.$('#entityConfirm').textContent, '删除');
      h.click('#entityCancel');
    }
  } finally { await h.close(); }
});
