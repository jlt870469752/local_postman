const fs = require('node:fs');
const assert = require('node:assert/strict');
const { JSDOM, VirtualConsole } = require('jsdom');
const tick = () => new Promise(resolve => setImmediate(resolve));
const settle = async () => { for (let i = 0; i < 6; i++) await tick(); };
const clone = value => structuredClone(value);
const fixture = () => ({
  collections: [{ id: 'c-default', name: 'Original Collection', folders: [], items: [{ id: 'original', name: 'Saved request', method: 'GET', url: 'http://example.test/original', params: [], headers: [], body: '' }] }],
  environments: [{ id: 'env-default', name: 'Original Environment', values: { token: 'local-test' } }],
  history: [{ id: 'h-default', name: 'Original History', url: 'http://example.test/history' }],
  gitRepository: '/local/default-repo', gitWorkspaceRevision: 'revision-default',
});
const empty = () => ({ collections: [], environments: [], history: [] });
async function harness({ runningService = false } = {}) {
  const errors = [], calls = [], vc = new VirtualConsole();
  vc.on('jsdomError', error => errors.push(error.message));
  const dom = new JSDOM('<div id="app"></div>', { url: 'http://localhost/', runScripts: 'outside-only', virtualConsole: vc });
  const w = dom.window; w.TextEncoder = TextEncoder;
  let activeId = 'default', failSave = false, failSwitch = false, failListAfterSwitch = false, releaseSend;
  const catalog = [{ id: 'default', name: 'My Workspace' }, { id: 'second', name: 'Second Workspace' }];
  const workspaces = new Map([['default', fixture()], ['second', empty()]]);
  w.testInvoke = async (command, args = {}) => {
    calls.push({ command, args: clone(args), activeId });
    if (command === 'load_workspace') return clone(workspaces.get(activeId));
    if (command === 'save_workspace') { if (failSave) throw Error('disk full'); workspaces.set(activeId, clone(args.workspace)); return; }
    if (command === 'workspace_list') { if (failListAfterSwitch && activeId !== 'default') throw Error('catalog temporarily unreadable'); return catalog.map(row => ({ ...row, active: row.id === activeId })); }
    if (command === 'workspace_create') { if (!args.name.trim()) throw Error('Workspace name is required'); const item = { id: 'created', name: args.name.trim() }; catalog.push(item); workspaces.set(item.id, empty()); return { ...item, active: false }; }
    if (command === 'workspace_rename') { catalog.find(row => row.id === args.id).name = args.name.trim(); return; }
    if (command === 'workspace_delete') { assert.notEqual(args.id, activeId); catalog.splice(catalog.findIndex(row => row.id === args.id), 1); return; }
    if (command === 'workspace_switch') { if (failSwitch) throw Error('target workspace unreadable'); assert.ok(workspaces.has(args.id)); activeId = args.id; return clone(workspaces.get(activeId)); }
    if (command === 'git_status') return 'main';
    if (command === 'mock_status') return [];
    if (command === 'service_status') return runningService ? [{ id: 'running-service', running: true }] : [];
    if (command === 'send_request') return await new Promise(resolve => { releaseSend = () => resolve({ status: 200, ok: true, time_ms: 1, body: '{}', headers: {}, size: 2 }); });
    throw Error('Unexpected command ' + command);
  };
  w.__TAURI_INTERNALS__ = {};
  const modules = ['src/assets/postman-icons.js', 'src/import-request.js', 'src/import-collection.js', 'src/code-snippets.js'].map(file => fs.readFileSync(file, 'utf8').replace(/^export /gm, '')).join('\n');
  const source = fs.readFileSync('src/app.js', 'utf8').replace(/^import .*;\s*$/gm, '');
  w.eval('const invoke=window.testInvoke;const listen=()=>Promise.resolve();const getCurrentWindow=()=>({onCloseRequested(){}});\n' + modules + '\n' + source);
  await settle();
  const $ = selector => w.document.querySelector(selector);
  const click = selector => { assert.ok($(selector), 'Missing ' + selector); $(selector).click(); };
  const fill = (selector, value) => { assert.ok($(selector), 'Missing ' + selector); $(selector).value = value; $(selector).dispatchEvent(new w.Event('input', { bubbles: true })); };
  const menu = async () => { click('#workspaceMenu'); await settle(); assert.ok($('#workspaceOverlay')); };
  return { w, $, click, fill, menu, calls, workspaces, active: () => activeId,
    failSave(value) { failSave = value; }, failSwitch(value) { failSwitch = value; }, failListAfterSwitch(value) { failListAfterSwitch = value; },
    releaseSend() { assert.ok(releaseSend); releaseSend(); },
    async close() { await settle(); assert.deepEqual(errors, [], 'UI handlers must not throw'); dom.window.close(); },
  };
}
(async () => {
  const menu = await harness();
  try {
    await menu.menu(); assert.equal(menu.$('#importText'), null, 'Workspace button must not open Import');
    assert.ok(menu.$('[data-switch-workspace="default"][aria-current="true"]'));
    assert.equal(menu.$('[data-delete-workspace="default"]'), null, 'Active workspace must not expose Delete');
    menu.fill('#workspaceSearch', 'SECOND'); assert.equal(menu.$('[data-switch-workspace="default"]'), null); assert.ok(menu.$('[data-switch-workspace="second"]'));
    menu.w.document.dispatchEvent(new menu.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(menu.$('#workspaceOverlay'), null); assert.equal(menu.$('#workspaceMenu').getAttribute('aria-expanded'), 'false');
  } finally { await menu.close(); }
  console.log('PASS: Workspace opens searchable local workspace menu, not Import, and Escape closes it');

  const create = await harness();
  try {
    create.fill('#requestName', 'Keep my draft'); await create.menu(); create.click('#createWorkspace');
    create.fill('#workspaceName', '  New Project  '); create.click('#confirmWorkspaceAction'); await settle();
    assert.equal(create.active(), 'created'); assert.match(create.$('#workspaceMenu').textContent, /New Project/);
    assert.equal(create.$('#requestName'), null, 'New workspace starts empty');
    assert.deepEqual(create.workspaces.get('created').collections, []);
    assert.equal(create.workspaces.get('default').collections[0].items[0].name, 'Keep my draft');
    assert.ok(create.workspaces.get('default').editorSession.requestBaselines.original, 'Saved baseline remains with original workspace');
    assert.equal(create.workspaces.get('created').gitRepository, undefined);
    assert.equal(create.workspaces.get('created').history.length, 0);
    assert.equal(create.workspaces.get('created').environments.length, 0);
    await create.menu(); create.click('[data-switch-workspace="default"]'); await settle();
    assert.equal(create.$('#requestName').value, 'Keep my draft');
    assert.ok(create.$('[data-select-tab="original"].is-dirty'), 'Unsaved request status survives a workspace roundtrip');
    assert.equal(create.workspaces.get('default').history[0].name, 'Original History');
    assert.equal(create.workspaces.get('default').gitRepository, '/local/default-repo');
  } finally { await create.close(); }
  console.log('PASS: Create starts empty and workspace roundtrip preserves independent drafts, history, environments and Git');

  const manage = await harness();
  try {
    await manage.menu(); manage.click('[data-rename-workspace="default"]'); manage.fill('#workspaceName', 'Renamed Project'); manage.click('#confirmWorkspaceAction'); await settle();
    assert.match(manage.$('#workspaceMenu').textContent, /Renamed Project/); assert.equal(manage.$('#workspaceOverlay'), null);
    await manage.menu(); manage.click('[data-delete-workspace="second"]'); manage.click('#cancelWorkspaceDialog');
    assert.equal(manage.calls.filter(call => call.command === 'workspace_delete').length, 0);
    await manage.menu(); manage.click('[data-delete-workspace="second"]'); manage.click('#confirmWorkspaceAction'); await settle();
    assert.equal(manage.active(), 'default'); await manage.menu(); assert.equal(manage.$('[data-switch-workspace="second"]'), null);
    assert.ok(manage.workspaces.has('second'), 'Deleted workspace data stays archived in backend storage');
  } finally { await manage.close(); }
  console.log('PASS: Rename updates current title and nonactive workspace deletion has a cancelable confirmation');

  for (const reason of ['save', 'switch']) {
    const failed = await harness();
    try {
      failed.fill('#requestName', 'Original draft remains'); await failed.menu();
      if (reason === 'save') failed.failSave(true); else failed.failSwitch(true);
      failed.click('[data-switch-workspace="second"]'); await settle();
      assert.equal(failed.active(), 'default'); assert.equal(failed.$('#requestName').value, 'Original draft remains');
      assert.match(failed.w.document.body.textContent, reason === 'save' ? /disk full/ : /target workspace unreadable/);
      assert.equal(failed.$('#app').inert, false);
      if (reason === 'save') assert.equal(failed.calls.filter(call => call.command === 'workspace_switch').length, 0);
    } finally { await failed.close(); }
  }
  console.log('PASS: Failed current save or target load keeps the original workspace and editor intact');

  const catalogFailure = await harness();
  try {
    const target = fixture(); target.collections[0].items[0].name = 'Target request'; target.gitRepository = '/local/second-repo';
    catalogFailure.workspaces.set('second', target);
    await catalogFailure.menu(); catalogFailure.failListAfterSwitch(true); catalogFailure.click('[data-switch-workspace="second"]'); await settle();
    assert.equal(catalogFailure.active(), 'second');
    assert.equal(catalogFailure.$('#requestName').value, 'Target request', 'Successful switch must render target data even if catalog refresh fails afterward');
    assert.match(catalogFailure.$('#workspaceMenu').textContent, /Second Workspace/);
    catalogFailure.fill('#requestName', 'Target edited'); catalogFailure.click('[data-builder="Body"]');
    assert.equal(catalogFailure.workspaces.get('second').collections[0].items[0].name, 'Target edited');
    assert.equal(catalogFailure.workspaces.get('default').collections[0].items[0].name, 'Saved request');
  } finally { await catalogFailure.close(); }
  console.log('PASS: Successful switch renders target data even when a later catalog refresh fails');


  const pending = await harness();
  try {
    pending.click('#send'); await settle(); await pending.menu(); pending.click('[data-switch-workspace="second"]'); await settle();
    assert.equal(pending.active(), 'default'); assert.equal(pending.calls.filter(call => call.command === 'workspace_switch').length, 0);
    assert.match(pending.w.document.body.textContent, /Wait for requests/); pending.releaseSend(); await settle();
  } finally { await pending.close(); }
  const running = await harness({ runningService: true });
  try {
    await running.menu(); running.click('[data-switch-workspace="second"]'); await settle();
    assert.equal(running.active(), 'default'); assert.equal(running.calls.filter(call => call.command === 'workspace_switch').length, 0);
    assert.match(running.w.document.body.textContent, /stop running local services/);
  } finally { await running.close(); }
  console.log('PASS: Pending requests and running local services block workspace switching');
})().catch(error => { console.error(error); process.exitCode = 1; });
