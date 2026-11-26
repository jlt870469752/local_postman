const fs = require('node:fs');
const assert = require('node:assert/strict');
const { JSDOM, VirtualConsole } = require('jsdom');

const tick = () => new Promise(resolve => setImmediate(resolve));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const fixture = () => ({
  collections: [{ id: 'c', name: 'My saved collection', folders: [], items: [
    { id: 'a', name: 'First saved request', method: 'GET', url: 'http://example.test/a', params: [], headers: [], body: '' },
    { id: 'b', name: 'Second saved request', method: 'GET', url: 'http://example.test/b', params: [], headers: [], body: '' },
  ] }],
  environments: [], history: [],
  editorSession: { openRequestTabs: ['a', 'b'], selectedRequestTab: 'a', requestBaselines: {} },
});

async function harness({ loaded = fixture(), loadError = null, backup = null, native = false } = {}) {
  const errors = [], calls = [], saves = [], vc = new VirtualConsole();
  vc.on('jsdomError', error => errors.push(error.message));
  const dom = new JSDOM('<div id="app"></div>', { url: 'http://localhost/', runScripts: 'outside-only', virtualConsole: vc });
  const w = dom.window;
  w.TextEncoder = TextEncoder;
  let readError = loadError, readValue = loaded, failSave = false, closeRequested, destroyed = false;
  w.testInvoke = async (command, args) => {
    calls.push(command);
    if (command === 'load_workspace') { if (readError) throw Error(readError); return structuredClone(readValue); }
    if (command === 'save_workspace') { if (failSave) throw Error('disk full'); saves.push(structuredClone(args.workspace)); return; }
    if (command === 'workspace_recovery_info') return { backupAvailable: !!backup };
    if (command === 'restore_workspace_backup') { assert.ok(backup); readError = null; readValue = structuredClone(backup); return structuredClone(backup); }
    if (command === 'git_status') return 'main';
    if (command === 'mock_status' || command === 'service_status') return [];
    throw Error('Unexpected command ' + command);
  };
  if (native) w.__TAURI_INTERNALS__ = {};
  w.testWindow = {
    onCloseRequested(callback) { closeRequested = callback; },
    async destroy() { destroyed = true; },
  };
  const modules = ['src/assets/postman-icons.js', 'src/import-request.js', 'src/import-collection.js', 'src/code-snippets.js']
    .map(p => fs.readFileSync(p, 'utf8').replace(/^export /gm, '')).join('\n');
  const source = fs.readFileSync('src/app.js', 'utf8').replace(/^import .*;\s*$/gm, '');
  w.eval('const invoke=window.testInvoke;const listen=()=>Promise.resolve();const getCurrentWindow=()=>window.testWindow;\n' + modules + '\n' + source);
  await tick(); await tick();
  const $ = selector => w.document.querySelector(selector);
  const click = selector => { assert.ok($(selector), 'Missing ' + selector); $(selector).click(); };
  const fill = (selector, value) => { assert.ok($(selector), 'Missing ' + selector); $(selector).value = value; $(selector).dispatchEvent(new w.Event('input', { bubbles: true })); };
  return {
    w, $, click, fill, saves, calls,
    read(value) { readValue = value; readError = null; },
    failSave(value) { failSave = value; },
    async requestClose() { let prevented = false; await closeRequested({ preventDefault() { prevented = true; } }); return { prevented, destroyed }; },
    async close() { await tick(); assert.deepEqual(errors, [], 'UI handlers must not throw'); dom.window.close(); },
  };
}

(async () => {
  for (const options of [{ loadError: 'WORKSPACE_READ_FAILED: access denied' }, { loaded: { collections: {} } }]) {
    const h = await harness(options);
    try {
      assert.ok(h.$('.workspace-recovery'), 'Read and malformed workspace errors must pause editing');
      assert.equal(h.$('#url'), null);
      assert.doesNotMatch(h.w.document.body.textContent, /Demo APIs/);
      await wait(330);
      assert.equal(h.saves.length, 0, 'A failed load must never replace existing data with seeded data');
      assert.ok(h.$('#retryWorkspace'));
    } finally { await h.close(); }
  }
  console.log('PASS: unreadable and malformed workspaces block editing and never overwrite data');

  const missing = await harness({ loadError: 'WORKSPACE_NOT_FOUND: first launch' });
  try {
    assert.equal(missing.$('.workspace-recovery'), null);
    assert.ok(missing.$('#url'));
    assert.match(missing.w.document.body.textContent, /Demo APIs/);
    assert.equal(missing.saves.length, 0, 'First launch does not write until an actual edit');
    missing.fill('#requestName', 'First local edit'); await wait(350);
    assert.equal(missing.saves.at(-1).collections[0].items[0].name, 'First local edit');
  } finally { await missing.close(); }
  console.log('PASS: only a missing workspace initializes first-launch content');

  const retry = await harness({ loadError: 'WORKSPACE_READ_FAILED: temporary failure' });
  try {
    retry.read(fixture()); retry.click('#retryWorkspace'); await tick(); await tick();
    assert.equal(retry.$('.workspace-recovery'), null);
    assert.equal(retry.$('#requestName').value, 'First saved request');
    assert.equal(retry.saves.length, 0, 'Retry reads existing data without saving it back');
  } finally { await retry.close(); }
  const restored = await harness({ loadError: 'Invalid workspace JSON', backup: fixture() });
  try {
    assert.ok(restored.$('#restoreWorkspaceBackup')); restored.click('#restoreWorkspaceBackup'); await tick();
    assert.equal(restored.$('.workspace-recovery'), null);
    assert.equal(restored.$('#requestName').value, 'First saved request');
    assert.ok(restored.calls.includes('restore_workspace_backup'));
    assert.equal(restored.saves.length, 0, 'Backend restore performs recovery; frontend must not seed over it');
  } finally { await restored.close(); }
  console.log('PASS: retry and last-good backup recovery restore the saved workspace');

  const typing = await harness();
  try {
    for (let i = 1; i <= 10; i++) typing.fill('#requestName', 'Typed ' + 'x'.repeat(i));
    assert.equal(typing.saves.length, 0, 'Keystrokes must not each snapshot and write the full workspace');
    await wait(350);
    assert.equal(typing.saves.length, 1, 'A burst of edits produces one debounced write');
    assert.equal(typing.saves[0].collections[0].items[0].name, 'Typed xxxxxxxxxx');
    typing.fill('#requestName', 'Flush on navigation'); typing.click('[data-select-tab="b"]');
    assert.equal(typing.$('#requestName').value, 'Second saved request');
    assert.equal(typing.saves.at(-1).collections[0].items[0].name, 'Flush on navigation');
    const writesAfterNavigation = typing.saves.length; await wait(350);
    assert.equal(typing.saves.length, writesAfterNavigation, 'Navigation cancels the obsolete debounce timer');
    typing.click('[data-select-tab="a"]');
    assert.equal(typing.$('#requestName').value, 'Flush on navigation');
  } finally { await typing.close(); }
  console.log('PASS: typing is debounced and navigation flushes the latest editor state');

  const pagehide = await harness();
  try {
    pagehide.fill('#requestName', 'Last browser edit');
    pagehide.w.dispatchEvent(new pagehide.w.Event('pagehide'));
    assert.equal(pagehide.saves.at(-1).collections[0].items[0].name, 'Last browser edit');
  } finally { await pagehide.close(); }
  const nativeClose = await harness({ native: true });
  try {
    nativeClose.fill('#requestName', 'Last native edit'); nativeClose.failSave(true);
    assert.deepEqual(await nativeClose.requestClose(), { prevented: true, destroyed: false }, 'Failed final save keeps the native window open');
    assert.match(nativeClose.w.document.body.textContent, /disk full/);
    assert.equal(nativeClose.$('#requestName').value, 'Last native edit');
    nativeClose.failSave(false);
    assert.deepEqual(await nativeClose.requestClose(), { prevented: true, destroyed: true });
    assert.equal(nativeClose.saves.at(-1).collections[0].items[0].name, 'Last native edit');
  } finally { await nativeClose.close(); }
  console.log('PASS: pagehide and native close flush final edits, and native save failure prevents closing');
})().catch(error => { console.error(error); process.exitCode = 1; });
