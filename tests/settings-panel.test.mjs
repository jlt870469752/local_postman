import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM, VirtualConsole } from 'jsdom';

const source = (await readFile(new URL('../src/settings-panel.js', import.meta.url), 'utf8')).replace(/^import .*\n/gm, '').replace(/^export /gm, '');
const languageSource = (await readFile(new URL('../src/i18n.js', import.meta.url), 'utf8')).replace(/^export /gm, '');
const clone = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));
const settle = async () => { for (let i = 0; i < 5; i++) await tick(); };
async function harness(overrides = {}, actions = {}) {
  const errors = [], calls = [], writes = [], changes = [];
  const vc = new VirtualConsole(); vc.on('jsdomError', error => errors.push(error.message));
  const dom = new JSDOM('<div id="app"><button id="opener">Settings</button></div>', { runScripts: 'outside-only', url: 'http://localhost/', virtualConsole: vc });
  const w = dom.window;
  let failure = '', updateFailure = '', filePath = '/Users/test/cert.pem', gate = null, infoGate = null;
  w.testInvoke = async (command, args) => {
    calls.push({ command, args: clone(args || {}) });
    if (command === 'settings_load') return clone(overrides);
    if (command === 'settings_save') {
      const snapshot = clone(args.settings); writes.push(snapshot);
      if (gate) await gate;
      if (failure) throw Error(failure);
      return snapshot;
    }
    if (command === 'settings_choose_path') return filePath;
    if (command === 'settings_info') { if (infoGate) await infoGate; return { version: '0.2.0', platform: 'macos', arch: 'aarch64', dataDirectory: '/Users/test/Library/LocalPostman', preferencesPath: '/Users/test/Library/LocalPostman/preferences.json' }; }
    if (command === 'settings_check_update') { if (updateFailure) throw Error(updateFailure); return { status: 'unavailable', message: 'No signed update feed is configured.' }; }
    if (command === 'settings_open_path') return null;
    throw Error('Unexpected invoke: ' + command);
  };
  w.settingsActions = actions;
  w.testChange = settings => changes.push(clone(settings));
  w.eval('(()=>{' + languageSource + '\nObject.assign(window,{setLanguage,translateUi});})();');
  w.eval(source + '\nwindow.panel=createSettingsPanel({invoke:window.testInvoke,onChange:window.testChange,...window.settingsActions});');
  await w.panel.ready;
  w.document.getElementById('opener').focus();
  await w.panel.open(); await settle();
  const $ = selector => w.document.querySelector(selector);
  const click = selector => { const target = typeof selector === 'string' ? $(selector) : selector; assert.ok(target, 'Missing control: ' + selector); target.click(); };
  const fill = (selector, value, event = 'input') => { const target = $(selector); assert.ok(target, 'Missing input: ' + selector); target.value = value; target.dispatchEvent(new w.Event(event, { bubbles: true })); };
  const section = name => click(`[data-settings-section="${name}"]`);
  const preference = path => $(`[data-preference="${path}"]`);
  const dispose = async () => { failure = ''; gate = null; await w.panel.close(); assert.deepEqual(errors, []); w.close(); };
  return { w, $, click, fill, section, preference, calls, writes, changes, panel: w.panel, dispose,
    fail: value => { failure = value; }, failUpdate: value => { updateFailure = value; }, choose: value => { filePath = value; },
    holdInfo: () => { let release; infoGate = new Promise(resolve => { release = resolve; }); return () => { infoGate = null; release(); }; },
    hold: () => { let release; gate = new Promise(resolve => { release = resolve; }); return () => { gate = null; release(); }; },
  };
}

test('Settings provides implemented categories without AI or Add-ons, loads native preferences, and traps focus', async () => {
  const h = await harness({ general: { timeout: 4500 }, theme: { mode: 'dark' } });
  try {
    assert.deepEqual([...h.w.document.querySelectorAll('[data-settings-section]')].map(button => button.textContent.trim()), ['General','Themes','Shortcuts','Data','Certificates','Proxy','Update','About']);
    assert.equal(h.$('[data-settings-section=addons]'), null);
    assert.doesNotMatch(h.$('.settings-modal').textContent, /Postman CLI/);
    assert.equal(h.preference('general.timeout').value, '4500');
    assert.equal(h.w.document.documentElement.dataset.theme, 'dark');
    assert.equal(h.$('#app').inert, true);
    assert.equal(h.preference('general.sslKeyLog').disabled, true, 'Native TLS limitation is explicit');
    h.$('#settingsClose').focus();
    h.w.document.dispatchEvent(new h.w.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
    assert.notEqual(h.w.document.activeElement.id, 'opener');
    await h.panel.close();
    assert.equal(h.$('#app').inert, false);
    assert.equal(h.w.document.activeElement.id, 'opener');
  } finally { await h.dispose(); }
});

test('Edits survive category navigation and saves use immutable snapshots in order', async () => {
  const h = await harness();
  try {
    h.fill('[data-preference="general.timeout"]', '1200');
    assert.equal(h.$('#settingsRetrySave').hidden, false);
    const release = h.hold();
    const first = h.panel.flush(); await settle();
    h.fill('[data-preference="general.timeout"]', '2400');
    h.section('proxy');
    const second = h.panel.flush();
    release(); await Promise.all([first, second]);
    assert.equal(h.writes[0].general.timeout, 1200);
    assert.equal(h.writes[1].general.timeout, 2400);
    assert.equal(h.panel.getSettings().general.timeout, 2400);
    h.section('general');
    assert.equal(h.preference('general.timeout').value, '2400');
    assert.equal(h.$('#settingsRetrySave').hidden, true);
  } finally { await h.dispose(); }
});

test('Save failure preserves the draft and keeps the panel open until retry succeeds', async () => {
  const h = await harness();
  try {
    h.fill('[data-preference="general.timeout"]', '1200'); h.fail('Disk is full');
    assert.equal(await h.panel.close(), false);
    assert.equal(h.panel.isOpen(), true);
    assert.equal(h.panel.getSettings().general.timeout, 0);
    assert.equal(h.preference('general.timeout').value, '1200');
    assert.match(h.$('#settingsSaveState').textContent, /Disk is full/);
    h.fail(''); h.click('#settingsRetrySave'); await settle();
    assert.equal(h.panel.getSettings().general.timeout, 1200);
    assert.equal(await h.panel.close(), true);
  } finally { await h.dispose(); }
});

test('Theme previews apply instantly and revert on native save failure', async () => {
  const h = await harness();
  try {
    h.section('themes'); h.fail('Read only');
    h.click('[data-preference="theme.mode"][value="dark"]');
    assert.equal(h.w.document.documentElement.dataset.theme, 'dark');
    await assert.rejects(h.panel.flush(), /Read only/);
    assert.equal(h.w.document.documentElement.dataset.theme, 'light');
    assert.equal(h.$('[data-preference="theme.mode"][value="dark"]').checked, true, 'Failed draft can be retried');
    h.fail(''); await h.panel.flush();
    assert.equal(h.w.document.documentElement.dataset.theme, 'dark');
  } finally { await h.dispose(); }
});

test('Certificate and proxy controls persist paths and credentials without reading key contents', async () => {
  const h = await harness();
  try {
    h.section('certificates'); h.click('#settingsAddCertificate');
    h.fill('[data-certificate="0"][data-field="host"]', 'api.example.test');
    h.choose('/Users/test/client.crt'); h.click('[data-certificate-path="0"][data-field="certPath"]'); await settle();
    h.choose('/Users/test/private.key'); h.click('[data-certificate-path="0"][data-field="keyPath"]'); await settle();
    h.fill('[data-certificate="0"][data-field="passphrase"]', 'local secret'); await h.panel.flush();
    const cert = h.panel.getSettings().certificates.clients[0];
    assert.equal(cert.host, 'api.example.test'); assert.equal(cert.keyPath, '/Users/test/private.key');
    assert.equal(h.$('[data-certificate="0"][data-field="passphrase"]').type, 'password');
    assert.deepEqual(h.calls.filter(call => call.command === 'settings_choose_path').map(call => call.args.kind), ['certificate','privateKey']);
    h.section('proxy'); h.fill('[data-preference="proxy.host"]', '127.0.0.1'); h.click('[data-preference="proxy.enabled"]');
    h.fill('[data-preference="proxy.username"]', 'proxy-user'); h.fill('[data-preference="proxy.password"]', 'proxy-password'); h.fill('[data-preference="proxy.bypass"]', 'localhost, .example.test');
    await h.panel.flush();
    assert.equal(h.panel.getSettings().proxy.enabled, true); assert.equal(h.panel.getSettings().proxy.password, 'proxy-password');
    assert.equal(h.panel.getSettings().proxy.bypass, 'localhost, .example.test');
    assert.equal(h.calls.some(call => /read.*file|private.*content/i.test(call.command)), false);
  } finally { await h.dispose(); }
});

test('Destructive data actions require confirmation and prevent duplicate execution', async () => {
  let historyCalls = 0, resetCalls = 0, release;
  const h = await harness({}, { onClearHistory: async () => { historyCalls++; await new Promise(resolve => { release = resolve; }); }, onReset: async () => { resetCalls++; throw Error('Backup could not be created'); } });
  try {
    h.section('data'); h.click('#settingsClearHistory');
    assert.equal(historyCalls, 0); h.click('#settingsCancelAction'); assert.equal(historyCalls, 0);
    h.click('#settingsClearHistory'); h.click('#settingsConfirmAction'); h.click('#settingsConfirmAction');
    assert.equal(historyCalls, 1); release(); await settle();
    assert.match(h.$('#settingsSaveState').textContent, /History cleared/);
    h.click('#settingsReset'); h.click('#settingsConfirmAction'); await settle();
    assert.equal(resetCalls, 1); assert.match(h.$('#settingsSaveState').textContent, /Backup could not be created/);
    assert.ok(h.$('.settings-confirmation'), 'Failed reset keeps the confirmation available');
  } finally { await h.dispose(); }
});

test('About and Update use native status instead of placeholder success', async () => {
  const h = await harness();
  try {
    h.section('about'); assert.match(h.$('.settings-content').textContent, /macos \(aarch64\)/);
    h.click('#settingsOpenData'); await settle();
    assert.equal(h.calls.find(call => call.command === 'settings_open_path').args.path, '/Users/test/Library/LocalPostman');
    h.section('update'); assert.equal(h.preference('update.automaticCheck').disabled, true);
    h.click('#settingsCheckUpdate'); await settle(); assert.match(h.$('#settingsUpdateResult').textContent, /No signed update feed/);
    h.failUpdate('Network unavailable'); h.click('#settingsCheckUpdate'); await settle(); assert.match(h.$('#settingsUpdateResult').textContent, /Network unavailable/);
  } finally { await h.dispose(); }
});

test('Import failures keep Data open and remain visible without unhandled errors', async () => {
  const h = await harness({}, { onImport: async () => { throw Error('Invalid import file'); } });
  try {
    h.section('data'); h.click('#settingsImport'); await settle();
    assert.equal(h.panel.isOpen(), true);
    assert.equal(h.$('#settingsTitle').textContent, 'Data');
    assert.match(h.$('#settingsSaveState').textContent, /Invalid import file/);
  } finally { await h.dispose(); }
});

test('Invalid numeric drafts stay visible after navigation and cannot be silently discarded on close', async () => {
  const h = await harness();
  try {
    h.fill('[data-preference="general.timeout"]', '-1');
    h.section('proxy'); h.section('general');
    assert.equal(h.preference('general.timeout').value, '-1');
    assert.equal(await h.panel.close(), false);
    assert.equal(h.panel.getSettings().general.timeout, 0);
    assert.equal(h.writes.length, 0);
    h.fill('[data-preference="general.timeout"]', '2500');
    await h.panel.flush();
    assert.equal(h.panel.getSettings().general.timeout, 2500);
  } finally { await h.dispose(); }
});

test('Invalid edits made while a write is pending still block close after that write completes', async () => {
  const h = await harness();
  try {
    h.fill('[data-preference="general.timeout"]', '1200');
    const release = h.hold(); const saving = h.panel.flush(); await settle();
    h.fill('[data-preference="general.timeout"]', '-1');
    release(); await saving;
    assert.equal(await h.panel.close(), false);
    assert.equal(h.panel.isOpen(), true);
    assert.equal(h.panel.getSettings().general.timeout, 1200);
    h.fill('[data-preference="general.timeout"]', '2400'); await h.panel.flush();
  } finally { await h.dispose(); }
});


test('User interface preferences and editor font family persist and stay visible across sections', async () => {
  const h = await harness();
  try {
    assert.ok([...h.w.document.querySelectorAll('.settings-content h3')].some(el => el.textContent === 'User interface'));
    for (const [path,expected] of [['alwaysAskClosingUnsavedTabs',true],['showIconsWithTabNames',true],['twoPane',false],['swapSidebars',false]]) {
      assert.equal(h.preference('general.'+path).checked, expected);
      h.click('[data-preference="general.'+path+'"]');
    }
    h.fill('[data-preference="general.editorFontFamily"]', 'Monaco, Menlo, monospace', 'change');
    assert.equal(h.w.document.documentElement.style.getPropertyValue('--editor-font-family'), 'Monaco, Menlo, monospace');
    h.section('shortcuts');
    const help = h.$('.settings-shortcut-list').textContent;
    for (const label of ['Switch to next tab','Switch to previous tab','Switch to tab at position','Switch to last tab']) assert.ok(help.includes(label));
    await h.panel.flush(); h.section('general');
    const saved = h.panel.getSettings().general;
    assert.equal(saved.alwaysAskClosingUnsavedTabs,false); assert.equal(saved.showIconsWithTabNames,false);
    assert.equal(saved.twoPane,true); assert.equal(saved.swapSidebars,true);
    assert.equal(saved.editorFontFamily,'Monaco, Menlo, monospace');
    assert.equal(h.preference('general.editorFontFamily').value,'Monaco, Menlo, monospace');
  } finally { await h.dispose(); }
});

test('Editor fonts are a dropdown, apply every selected family and survive reload', async () => {
  const h = await harness();
  let persisted;
  try {
    const field = h.preference('general.editorFontFamily');
    assert.equal(field.tagName, 'SELECT');
    assert.deepEqual([...field.options].map(option => option.textContent), ['System default', 'Menlo', 'Monaco', 'Courier New']);
    assert.equal(h.$('input[data-preference="general.editorFontFamily"]'), null);
    for (const option of field.options) {
      h.fill('[data-preference="general.editorFontFamily"]', option.value, 'change');
      assert.equal(h.w.document.documentElement.style.getPropertyValue('--editor-font-family'), option.value);
    }
    await h.panel.flush(); persisted = h.panel.getSettings();
    assert.equal(persisted.general.editorFontFamily, 'Courier New, monospace');
  } finally { await h.dispose(); }
  const restored = await harness(persisted);
  try {
    assert.equal(restored.preference('general.editorFontFamily').value, 'Courier New, monospace');
    assert.equal(restored.w.document.documentElement.style.getPropertyValue('--editor-font-family'), 'Courier New, monospace');
  } finally { await restored.dispose(); }
});

test('Legacy editor fonts map to a supported choice or fall back to the default', async () => {
  for (const [legacy, expected] of [['Monaco, monospace', 'Monaco, Menlo, monospace'], ['Unavailable font', 'ui-monospace, SFMono-Regular, Menlo, monospace']]) {
    const h = await harness({ general: { editorFontFamily: legacy } });
    try {
      assert.equal(h.preference('general.editorFontFamily').value, expected);
      assert.equal(h.w.document.documentElement.style.getPropertyValue('--editor-font-family'), expected);
      assert.equal(h.panel.getSettings().general.editorFontFamily, expected);
    } finally { await h.dispose(); }
  }
});

test('A failed font save restores the effective font and retains the selected draft for retry', async () => {
  const h = await harness();
  try {
    const previous = h.panel.getSettings().general.editorFontFamily;
    h.fail('Read only');
    h.fill('[data-preference="general.editorFontFamily"]', 'Monaco, Menlo, monospace', 'change');
    assert.equal(h.w.document.documentElement.style.getPropertyValue('--editor-font-family'), 'Monaco, Menlo, monospace');
    await assert.rejects(h.panel.flush(), /Read only/);
    assert.equal(h.w.document.documentElement.style.getPropertyValue('--editor-font-family'), previous);
    assert.equal(h.preference('general.editorFontFamily').value, 'Monaco, Menlo, monospace');
    assert.equal(h.panel.getSettings().general.editorFontFamily, previous);
    h.fail(''); await h.panel.flush();
    assert.equal(h.panel.getSettings().general.editorFontFamily, 'Monaco, Menlo, monospace');
    assert.equal(h.w.document.documentElement.style.getPropertyValue('--editor-font-family'), 'Monaco, Menlo, monospace');
  } finally { await h.dispose(); }
});

test('A delayed application-info reply does not replace an active General control or its value', async () => {
  const h = await harness();
  try {
    const release = h.holdInfo(); await h.panel.open('about');
    h.section('general');
    h.fill('[data-preference="general.editorFontFamily"]', 'Monaco, Menlo, monospace', 'change');
    const field = h.preference('general.editorFontFamily'); field.focus();
    release(); await settle();
    assert.equal(h.preference('general.editorFontFamily'),field,'Read-only info must not rebuild unrelated controls');
    assert.equal(h.w.document.activeElement,field);
    assert.equal(field.value,'Monaco, Menlo, monospace');
  } finally { await h.dispose(); }
});

test('Language switches immediately, persists, reloads and restores English labels without changing data', async () => {
  const h = await harness({ certificates: { clients: [{ id:'cert-language', host:'Request', port:443, certPath:'/Users/test/Save.pem', keyPath:'', passphrase:'Settings' }] } });
  let persisted;
  try {
    assert.equal(h.$('[data-preference="general.language"][value="en"]').checked, true);
    h.click('[data-preference="general.language"][value="zh-CN"]');
    assert.equal(h.w.document.documentElement.lang, 'zh-CN');
    assert.notEqual(h.$('#settingsTitle').textContent, 'General');
    assert.equal(h.$('[data-preference="general.language"][value="en"]').parentElement.textContent.trim(), 'English');
    assert.equal(h.$('[data-preference="general.language"][value="zh-CN"]').parentElement.textContent.trim(), '简体中文');
    await h.panel.flush();
    persisted = h.panel.getSettings();
    assert.equal(persisted.general.language, 'zh-CN');
    h.section('certificates');
    assert.equal(h.$('.settings-certificate-card strong').textContent, 'Request');
    assert.equal(h.$('[data-certificate="0"][data-field="host"]').value, 'Request');
    assert.equal(h.$('[data-certificate="0"][data-field="passphrase"]').value, 'Settings');
    assert.equal(h.$('[data-certificate-path="0"][data-field="certPath"]').parentElement.querySelector('input').value, '/Users/test/Save.pem');
    h.section('general'); h.click('[data-preference="general.language"][value="en"]');
    assert.equal(h.w.document.documentElement.lang, 'en');
    assert.equal(h.$('#settingsTitle').textContent, 'General');
  } finally { await h.dispose(); }
  const reopened = await harness(persisted);
  try {
    assert.equal(reopened.w.document.documentElement.lang, 'zh-CN');
    assert.equal(reopened.$('[data-preference="general.language"][value="zh-CN"]').checked, true);
    assert.notEqual(reopened.$('#settingsTitle').textContent, 'General');
  } finally { await reopened.dispose(); }
});

test('Language preview reverts when saving fails and retains the selection for retry', async () => {
  const h = await harness();
  try {
    h.fail('Read only'); h.click('[data-preference="general.language"][value="zh-CN"]');
    assert.equal(h.w.document.documentElement.lang, 'zh-CN');
    await assert.rejects(h.panel.flush(), /Read only/);
    assert.equal(h.w.document.documentElement.lang, 'en');
    assert.equal(h.$('#settingsTitle').textContent, 'General');
    assert.equal(h.$('[data-preference="general.language"][value="zh-CN"]').checked, true);
    h.fail(''); await h.panel.flush();
    assert.equal(h.w.document.documentElement.lang, 'zh-CN');
    assert.equal(h.panel.getSettings().general.language, 'zh-CN');
  } finally { await h.dispose(); }
});
