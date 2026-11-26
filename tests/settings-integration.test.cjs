const fs = require('node:fs');
const assert = require('node:assert/strict');
const test = require('node:test');
const { JSDOM, VirtualConsole } = require('jsdom');
const tick = () => new Promise(resolve => setImmediate(resolve));
const settle = async () => { for (let i = 0; i < 7; i++) await tick(); };
const fixture = () => ({
  collections: [{ id: 'c', name: 'Local APIs', folders: [], items: [
    { id: 'a', name: 'First request', method: 'GET', url: 'http://example.test/a', headers: [], params: [], body: '' },
    { id: 'b', name: 'Second request', method: 'GET', url: 'http://example.test/b', headers: [], params: [], body: '' },
  ] }], environments: [], history: [{ id: 'h', name: 'Previous', method: 'GET', url: 'http://example.test/previous' }],
});
async function harness({ preferences = {}, runningMock = false, exportResult = '/tmp/localpostman-export.json' } = {}) {
  const errors = [], calls = [], writes = [], vc = new VirtualConsole();
  vc.on('jsdomError', error => errors.push(error.message));
  const dom = new JSDOM('<div id="app"></div>', { url: 'http://localhost/', runScripts: 'outside-only', virtualConsole: vc });
  const w = dom.window; w.TextEncoder = TextEncoder;
  w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  let workspace = fixture(), savedSettings, failSettings = false, failWorkspace = false;
  w.testInvoke = async (command, args = {}) => {
    calls.push({ command, args: structuredClone(args) });
    if (command === 'load_workspace') return structuredClone(workspace);
    if (command === 'workspace_list') return [{ id: 'default', name: 'My Workspace', active: true }];
    if (command === 'save_workspace') {
      if (failWorkspace) throw Error('workspace disk full');
      workspace = structuredClone(args.workspace); writes.push(workspace); return;
    }
    if (command === 'settings_load') return structuredClone(preferences);
    if (command === 'settings_save') {
      if (failSettings) throw Error('preferences disk full');
      savedSettings = structuredClone(args.settings); return savedSettings;
    }
    if (command === 'settings_info') return { version: '0.2.0', platform: 'macos', arch: 'arm64', dataDirectory: '/tmp/localpostman-test', preferencesPath: '/tmp/localpostman-test/preferences.json' };
    if (command === 'settings_check_update') return { status: 'unavailable', message: 'No update feed configured.' };
    if (command === 'git_status') return 'main';
    if (command === 'mock_status') return runningMock ? [{ id: 'running', port: 51234, logs: [] }] : [];
    if (command === 'service_status') return [];
    if (command === 'send_request') return { ok: true, status: 200, body: '{}', headers: {}, size: 2, time_ms: 1 };
    if (command === 'export_workspace') return exportResult;
    throw Error('Unexpected invoke: ' + command);
  };
  const settings = fs.readFileSync('src/settings-panel.js', 'utf8').replace(/^import .*;\s*$/gm, '').replace(/^export /gm, '');
  w.eval('(()=>{\n' + settings + '\nwindow.createSettingsPanel=createSettingsPanel;window.defaultSettings=defaultSettings;})();');
  const modules = ['src/assets/postman-icons.js', 'src/import-request.js', 'src/import-collection.js', 'src/code-snippets.js']
    .map(file => fs.readFileSync(file, 'utf8').replace(/^export /gm, '')).join('\n');
  const source = fs.readFileSync('src/app.js', 'utf8').replace(/^import .*;\s*$/gm, '');
  w.eval('const invoke=window.testInvoke;const createSettingsPanel=window.createSettingsPanel,defaultSettings=window.defaultSettings;\n' + modules + '\n' + source + '\nwindow.testPanel=settingsPanel;');
  await settle(); await w.testPanel.ready;
  const $ = selector => w.document.querySelector(selector);
  const click = selector => { assert.ok($(selector), 'Missing ' + selector); $(selector).click(); };
  const fill = (selector, value, event = 'input') => { assert.ok($(selector), 'Missing ' + selector); $(selector).value = value; $(selector).dispatchEvent(new w.Event(event, { bubbles: true })); };
  const key = (value, options = {}) => w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: value, metaKey: true, bubbles: true, cancelable: true, ...options }));
  const open = async section => { $('#appSettings').focus(); click('#appSettings'); await settle(); if (section) { click(`[data-settings-section="${section}"]`); await settle(); } };
  const saveSettings = async () => { await w.testPanel.flush(); await settle(); };
  return { w, $, click, fill, key, open, saveSettings, calls, writes, panel: w.testPanel,
    workspace: () => structuredClone(workspace), preferences: () => structuredClone(savedSettings),
    failSettings: value => { failSettings = value; }, failWorkspace: value => { failWorkspace = value; },
    async close() { failSettings = false; failWorkspace = false; await w.testPanel.close(); await settle(); assert.deepEqual(errors, [], 'App and panel handlers must not throw'); w.close(); },
  };
}

test('App settings opens the full panel while preserving the active request and closing restores interaction', async () => {
  const h = await harness();
  try {
    h.fill('#requestName', 'Unsaved current title'); const input = h.$('#requestName');
    await h.open();
    assert.equal(h.$('#requestName'), input); assert.equal(input.value, 'Unsaved current title');
    assert.equal(h.$('#app').inert, true);
    const layoutBefore = h.$('.canvas').className; h.key('v', { altKey: true });
    assert.equal(h.$('.canvas').className, layoutBefore, 'Application layout shortcuts must stay suspended while settings is open');
    assert.equal(h.w.document.querySelectorAll('[data-settings-section]').length, 8);
    assert.equal([...h.w.document.querySelectorAll('[data-settings-section]')].some(button => button.textContent.trim() === 'AI'), false);
    h.click('#settingsClose'); await settle();
    assert.equal(h.$('#settingsPanel'), null); assert.equal(h.$('#app').inert, false);
    assert.equal(h.$('#requestName').value, 'Unsaved current title');
    assert.equal(h.w.document.activeElement.id, 'appSettings');
  } finally { await h.close(); }
});

test('Global request preferences reach the send payload and visiting request settings preserves inheritance', async () => {
  const h = await harness({ preferences: { general: { timeout: 1200, httpVersion: 'http1', maxResponseSize: 8, verifySsl: false, followRedirects: false, disableCookies: true } } });
  try {
    h.click('[data-builder="Settings"]'); assert.equal(h.$('#requestTimeout').value, '1200');
    h.click('[data-builder="Params"]');
    await h.open(); h.fill('[data-preference="general.timeout"]', '2400'); await h.saveSettings();
    h.click('#settingsClose'); await settle(); h.click('#send'); await settle();
    const request = h.calls.findLast(call => call.command === 'send_request').args.request;
    assert.equal(request.settings.timeout, 2400, 'Viewing request settings must not freeze inherited timeout');
    assert.equal(request.settings.httpVersion, 'http1'); assert.equal(request.settings.maxResponseSize, 8);
    assert.equal(request.settings.verifySsl, false); assert.equal(request.settings.followRedirects, false); assert.equal(request.settings.disableCookies, true);
    h.click('[data-builder="Settings"]'); h.fill('#requestTimeout', '6500'); h.click('[data-builder="Params"]');
    await h.open(); h.fill('[data-preference="general.timeout"]', '3100'); await h.saveSettings();
    h.click('#settingsClose'); await settle(); h.click('#send'); await settle();
    assert.equal(h.calls.findLast(call => call.command === 'send_request').args.request.settings.timeout, 6500, 'An explicit request override still wins');
  } finally { await h.close(); }
});

test('Theme and editor preferences apply globally and successful writes persist the chosen values', async () => {
  const h = await harness();
  try {
    await h.open('themes'); h.click('[data-preference="theme.mode"][value="dark"]');
    assert.equal(h.w.document.documentElement.dataset.theme, 'dark'); await h.saveSettings();
    h.click('[data-settings-section="general"]'); h.fill('[data-preference="general.editorFontSize"]', '16'); await h.saveSettings();
    assert.equal(h.w.document.documentElement.style.getPropertyValue('--editor-font-size'), '16px');
    assert.equal(h.preferences().theme.mode, 'dark'); assert.equal(h.preferences().general.editorFontSize, 16);
    h.click('#settingsClose'); await settle(); assert.equal(h.w.document.documentElement.dataset.theme, 'dark');
  } finally { await h.close(); }
});

test('App keyboard shortcuts send, save, create and import while disabled shortcuts do not mutate requests', async () => {
  const h = await harness();
  try {
    h.key('Enter'); await settle(); assert.equal(h.calls.filter(call => call.command === 'send_request').length, 1);
    h.key('s'); assert.ok(h.$('.save-modal')); h.click('#cancelSave');
    h.key('t'); assert.equal(h.w.document.querySelectorAll('[data-select-tab]').length, 2);
    h.key('o'); assert.ok(h.$('.import-modal')); h.click('#cancelImport');
    h.key(','); await settle(); assert.ok(h.$('#settingsPanel'));
    h.click('[data-settings-section="shortcuts"]'); h.click('[data-preference="shortcuts.enabled"]'); await h.saveSettings();
    h.click('#settingsClose'); await settle();
    const beforeTabs = h.w.document.querySelectorAll('[data-select-tab]').length, beforeSend = h.calls.filter(call => call.command === 'send_request').length;
    h.key('t'); h.key('Enter'); h.key('o'); h.key('s'); await settle();
    assert.equal(h.w.document.querySelectorAll('[data-select-tab]').length, beforeTabs); assert.equal(h.calls.filter(call => call.command === 'send_request').length, beforeSend);
    assert.equal(h.$('.import-modal'), null); assert.equal(h.$('.save-modal'), null);
  } finally { await h.close(); }
});

test('Data actions persist only after confirmation and failed writes preserve the workspace', async () => {
  const h = await harness();
  try {
    await h.open('data'); h.click('#settingsClearHistory'); assert.equal(h.workspace().history.length, 1);
    h.click('#settingsCancelAction'); assert.equal(h.workspace().history.length, 1);
    h.click('#settingsClearHistory'); h.failWorkspace(true); h.click('#settingsConfirmAction'); await settle();
    assert.equal(h.workspace().history.length, 1); assert.match(h.$('#settingsSaveState').textContent, /workspace disk full/);
    h.failWorkspace(false); h.click('#settingsConfirmAction'); await settle();
    assert.equal(h.workspace().history.length, 0); assert.equal(h.workspace().collections[0].items.length, 2);
    h.click('#settingsReset'); h.click('#settingsConfirmAction'); await settle();
    assert.equal(h.workspace().collections.length, 0); assert.equal(h.$('#requestName'), null);
    assert.equal(h.calls.filter(call => call.command === 'save_workspace').at(-1).args.archiveCurrent, true, 'Reset archives the previous workspace');
  } finally { await h.close(); }
});

const importCollection = () => JSON.stringify({
  info: { name: 'Imported from settings', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
  item: [{ name: 'Imported endpoint', request: { method: 'GET', url: 'http://example.test/imported' } }],
});
const inertAncestor = element => {
  for (let node = element; node; node = node.parentElement) if (node.inert) return node;
  return null;
};

test('Settings import reuses the import dialog and cancelling restores the same Data panel', async () => {
  const h = await harness();
  try {
    await h.open('data');
    const panel = h.$('#settingsPanel');
    h.click('#settingsImport'); await settle();
    assert.equal(h.$('#settingsPanel'), panel, 'Import must retain the settings panel instance');
    assert.ok(h.$('.import-modal'), 'Import Data must open the existing import flow');
    assert.equal(inertAncestor(h.$('.import-modal')), null, 'Import controls must remain outside every inert background');
    assert.ok(inertAncestor(h.$('#settingsImport')), 'Settings must remain disabled behind import');
    assert.equal(h.$('#app').inert, true);
    h.click('#cancelImport'); await settle();
    assert.equal(h.$('.import-modal'), null);
    assert.equal(h.$('#settingsPanel'), panel);
    assert.equal(inertAncestor(h.$('#settingsImport')), null);
    assert.equal(h.$('[data-settings-section="data"]').getAttribute('aria-current'), 'page');
    assert.equal(h.w.document.activeElement.id, 'settingsImport');
    assert.equal(h.$('#app').inert, true, 'Cancelling import must keep the app blocked behind settings');
    assert.equal(h.workspace().collections.length, 1);
  } finally { await h.close(); }
});

test('A Collection JSON import succeeds without closing settings and errors can be corrected in place', async () => {
  const h = await harness();
  try {
    await h.open('data'); const panel = h.$('#settingsPanel');
    h.click('#settingsImport'); await settle();
    h.fill('#importText', '{ invalid JSON'); h.click('#confirmImport'); await settle();
    assert.equal(h.$('#settingsPanel'), panel);
    assert.ok(h.$('.import-modal'));
    assert.ok(h.$('.import-error').textContent.trim(), 'Parsing failures stay visible in the import dialog');
    assert.equal(h.$('#importText').value, '{ invalid JSON');
    assert.equal(inertAncestor(h.$('.import-modal')), null);
    assert.equal(h.workspace().collections.length, 1, 'Invalid input must not mutate workspace data');
    h.fill('#importText', importCollection()); h.click('#confirmImport'); await settle();
    assert.equal(h.$('.import-modal'), null);
    assert.equal(h.$('#settingsPanel'), panel);
    assert.equal(inertAncestor(h.$('#settingsImport')), null);
    assert.equal(h.$('[data-settings-section="data"]').getAttribute('aria-current'), 'page');
    const imported = h.workspace().collections.find(collection => collection.name === 'Imported from settings');
    assert.ok(imported);
    assert.equal(imported.items[0].name, 'Imported endpoint');
    assert.equal(imported.items[0].url, 'http://example.test/imported');
    assert.equal(h.$('#app').inert, true);
  } finally { await h.close(); }
});

test('Import owns keyboard focus and Escape closes only import while settings stays open', async () => {
  const h = await harness();
  try {
    await h.open('data'); const panel = h.$('#settingsPanel');
    h.click('#settingsImport'); await settle();
    h.$('#confirmImport').focus();
    h.$('#confirmImport').dispatchEvent(new h.w.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    assert.equal(h.w.document.activeElement.id, 'closeImport', 'Tab must wrap inside the foreground import dialog');
    h.$('#closeImport').dispatchEvent(new h.w.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
    assert.equal(h.w.document.activeElement.id, 'confirmImport', 'Settings focus trapping must not intercept import keys');
    h.key('Escape', { metaKey: false }); await settle();
    assert.equal(h.$('.import-modal'), null);
    assert.equal(h.$('#settingsPanel'), panel);
    assert.equal(inertAncestor(h.$('#settingsImport')), null);
    assert.equal(h.w.document.activeElement.id, 'settingsImport');
    h.key('Escape', { metaKey: false }); await settle();
    assert.equal(h.$('#settingsPanel'), null, 'A subsequent Escape can close settings normally');
    assert.equal(h.$('#app').inert, false);
  } finally { await h.close(); }
});

test('Cancelling the workspace export picker keeps settings open without reporting a successful export', async () => {
  const h = await harness({ exportResult: null });
  try {
    await h.open('data'); const panel = h.$('#settingsPanel');
    h.click('#settingsExport'); await settle();
    assert.equal(h.$('#settingsPanel'), panel);
    assert.equal(h.calls.filter(call => call.command === 'export_workspace').length, 1);
    assert.doesNotMatch(h.$('#settingsSaveState').textContent, /exported|已导出/i);
    assert.equal(h.$('#settingsExport').disabled, false);
  } finally { await h.close(); }
});

test('Workspace reset is blocked while a local service is running', async () => {
  const h = await harness({ runningMock: true });
  try {
    await h.open('data'); h.click('#settingsReset'); h.click('#settingsConfirmAction'); await settle();
    assert.equal(h.workspace().collections.length, 1);
    assert.match(h.$('#settingsSaveState').textContent, /stop running local services/i);
    assert.equal(h.calls.some(call => call.command === 'save_workspace' && call.args.archiveCurrent), false);
  } finally { await h.close(); }
});

test('Preferences save errors preserve the draft, active editor and prior effective request settings', async () => {
  const h = await harness({ preferences: { general: { timeout: 900 } } });
  try {
    h.fill('#requestName', 'Editor stays intact'); await h.open();
    h.fill('[data-preference="general.timeout"]', '4400'); h.failSettings(true); h.click('#settingsClose'); await settle();
    assert.ok(h.$('#settingsPanel')); assert.match(h.$('#settingsSaveState').textContent, /preferences disk full/);
    assert.equal(h.$('[data-preference="general.timeout"]').value, '4400'); assert.equal(h.$('#requestName').value, 'Editor stays intact');
    assert.equal(h.panel.getSettings().general.timeout, 900);
    h.failSettings(false); h.click('#settingsRetrySave'); await settle(); h.click('#settingsClose'); await settle();
    h.click('#send'); await settle(); assert.equal(h.calls.findLast(call => call.command === 'send_request').args.request.settings.timeout, 4400);
  } finally { await h.close(); }
});

test('Layout settings keep the open modal isolated from the app after rerendering', async () => {
  const h = await harness();
  try {
    h.fill('#requestName', 'Draft before layout change');
    await h.open(); h.click('[data-preference="general.twoPane"]'); await h.saveSettings();
    assert.ok(h.$('.canvas.two-pane')); assert.ok(h.$('#settingsPanel'));
    assert.equal(h.$('#requestName').value, 'Draft before layout change');
    assert.equal(h.$('#app').inert, true, 'Changing layout must not unlock the background behind an open settings modal');
    h.click('[data-settings-section="data"]'); h.click('#settingsClearHistory'); h.click('#settingsConfirmAction'); await settle();
    assert.equal(h.$('#app').inert, true, 'Data actions also retain modal isolation');
    h.click('#settingsClose'); await settle(); assert.equal(h.$('#app').inert, false);
  } finally { await h.close(); }
});

test('Updating inherited defaults while the request Settings tab is visible does not create a stale override', async () => {
  const h = await harness({ preferences: { general: { timeout: 1200, followRedirects: true } } });
  try {
    h.click('[data-builder="Settings"]');
    await h.open(); h.fill('[data-preference="general.timeout"]', '4500'); h.click('[data-preference="general.followRedirects"]'); await h.saveSettings();
    h.click('#settingsClose'); await settle(); h.click('#send'); await settle();
    const request = h.calls.findLast(call => call.command === 'send_request').args.request;
    assert.equal(request.settings.timeout, 4500, 'Stale request control values must not override the new inherited default');
    assert.equal(request.settings.followRedirects, false);
  } finally { await h.close(); }
});
