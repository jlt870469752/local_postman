const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = process.env.POSTMAN_TEST_ROOT || path.resolve(__dirname, '..');
const { JSDOM, VirtualConsole } = require(path.join(root, 'node_modules/jsdom'));
const tick = () => new Promise(resolve => setImmediate(resolve));
const flush = async () => { for (let i = 0; i < 4; i++) await tick(); };
const clone = value => JSON.parse(JSON.stringify(value));
const fixture = () => ({ collections: [
  { id: 'c-original', name: 'Original APIs', folders: [], items: [
    { id: 'r-original', name: 'Original request', method: 'GET', url: 'https://example.test/items?q=hello%20world', headers: { Accept: 'application/json' }, body: '{"original":true}' },
    { id: 'r-other', name: 'Other request', method: 'GET', url: 'https://example.test/other', headers: [], params: [], body: '' },
  ] },
  { id: 'c-target', name: 'Destination APIs', folders: [{ id: 'f-target', name: 'Destination folder', parentId: null }], items: [] },
], environments: [], history: [], mockServers: [] });

async function harness(workspace = fixture(), storage = {}) {
  const errors = [], vc = new VirtualConsole();
  vc.on('jsdomError', error => errors.push(error.message));
  const dom = new JSDOM('<div id="app"></div>', { runScripts: 'outside-only', url: 'http://localhost/', virtualConsole: vc });
  const w = dom.window;
  w.TextEncoder = TextEncoder;
  for (const [key, value] of Object.entries(storage)) w.localStorage.setItem(key, value);
  let saved, failWrites = false, writeGate = null, releaseWrite = null;
  w.testInvoke = async (command, args) => {
    if (command === 'load_workspace') return clone(workspace);
    if (command === 'save_workspace') {
      const snapshot = clone(args.workspace);
      if (writeGate) await writeGate;
      if (failWrites) throw Error('Disk is full');
      saved = snapshot;
      return;
    }
    if (command === 'git_status') return 'main';
    if (command === 'mock_status' || command === 'service_status') return [];
    throw Error('Unexpected invoke: ' + command);
  };
  const modules = ['src/assets/postman-icons.js', 'src/import-request.js', 'src/import-collection.js', 'src/code-snippets.js']
    .map(file => fs.readFileSync(path.join(root, file), 'utf8').replace(/^export /gm, '')).join('\n');
  const source = fs.readFileSync(path.join(root, 'src/app.js'), 'utf8').replace(/^import .*;\s*$/gm, '');
  w.eval('const invoke=window.testInvoke;\n' + modules + '\n' + source);
  await flush();
  const $ = selector => w.document.querySelector(selector);
  const all = selector => [...w.document.querySelectorAll(selector)];
  const click = target => {
    const el = typeof target === 'string' ? $(target) : target;
    assert.ok(el, 'Missing control: ' + target);
    el.click();
  };
  const fill = (selector, value) => {
    const el = $(selector);
    assert.ok(el, 'Missing field: ' + selector);
    el.value = value;
    el.dispatchEvent(new w.Event('input', { bubbles: true }));
  };
  const select = (selector, value) => {
    fill(selector, value);
    $(selector).dispatchEvent(new w.Event('change', { bubbles: true }));
  };
  const tab = id => $(`[data-select-tab="${id}"]`);
  const activeId = () => $('.request-tab[aria-selected="true"]')?.dataset.selectTab;
  const closeTab = (id = activeId()) => click(`[data-close-tab="${id}"]`);
  const escape = () => w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  const snapshot = () => clone(saved ?? workspace);
  const requests = () => snapshot().collections.flatMap(c => c.items);
  const storageSnapshot = () => Object.fromEntries(Object.keys(w.localStorage).map(key => [key, w.localStorage.getItem(key)]));
  const dispose = async () => { if (releaseWrite) releaseWrite(); await flush(); assert.deepEqual(errors, [], 'UI handlers must not throw'); w.close(); };
  return { w, $, all, click, fill, select, tab, activeId, closeTab, escape, snapshot, requests, storageSnapshot, dispose,
    failWrites: value => { failWrites = value; },
    holdWrites: () => { writeGate = new Promise(resolve => { releaseWrite = resolve; }); },
    releaseWrites: () => { writeGate = null; releaseWrite?.(); releaseWrite = null; },
  };
}

(async () => {
  const checks = [], failures = [];
  const test = async (name, run) => {
    try { await run(); checks.push(name); process.stdout.write('PASS: ' + name + '\n'); }
    catch (error) { failures.push(name); process.stderr.write('FAIL: ' + name + '\n' + error.stack + '\n'); }
  };
  await test('Empty new requests close directly and remove their temporary request record', async () => {
    const h = await harness();
    try {
      h.click('#newTab'); const id = h.activeId();
      h.closeTab(id); await flush();
      assert.equal(h.$('.unsaved-modal'), null);
      assert.equal(h.tab(id), null);
      assert.equal(h.requests().some(request => request.id === id), false);
      assert.equal(h.activeId(), 'r-original');
    } finally { await h.dispose(); }
  });
  await test('A new request whose URL was cleared closes without a save prompt', async () => {
    const h = await harness();
    try {
      h.click('#newTab'); const id = h.activeId();
      h.fill('#url', 'https://example.test/temporary'); h.fill('#url', '');
      h.closeTab(id); await flush();
      assert.equal(h.$('.unsaved-modal'), null);
      assert.equal(h.tab(id), null);
      assert.equal(h.requests().some(request => request.id === id), false);
    } finally { await h.dispose(); }
  });
  await test('Visiting empty request editor tabs does not turn defaults into content worth saving', async () => {
    const h = await harness();
    try {
      h.click('#newTab'); const id = h.activeId();
      for (const name of ['Headers', 'Authorization', 'Settings', 'Body', 'Docs', 'Params']) h.click(`[data-builder="${name}"]`);
      h.closeTab(id); await flush();
      assert.equal(h.$('.unsaved-modal'), null);
      assert.equal(h.tab(id), null);
      assert.equal(h.requests().some(request => request.id === id), false);
    } finally { await h.dispose(); }
  });
  await test('Closing an empty background request preserves the active request and its edits', async () => {
    const h = await harness();
    try {
      h.click('#newTab'); const id = h.activeId();
      h.click('[data-open-request="r-other"]');
      h.fill('#url', 'https://example.test/active-edited');
      h.closeTab(id); await flush();
      assert.equal(h.$('.unsaved-modal'), null);
      assert.equal(h.tab(id), null);
      assert.equal(h.activeId(), 'r-other');
      assert.equal(h.$('#url').value, 'https://example.test/active-edited');
      assert.equal(h.requests().some(request => request.id === id), false);
    } finally { await h.dispose(); }
  });
  await test('A restored empty draft closes directly after restart', async () => {
    let workspace, storage, id;
    const first = await harness();
    try {
      first.click('#newTab'); id = first.activeId();
      workspace = first.snapshot(); storage = first.storageSnapshot();
    } finally { await first.dispose(); }
    const h = await harness(workspace, storage);
    try {
      assert.ok(h.tab(id));
      h.closeTab(id); await flush();
      assert.equal(h.$('.unsaved-modal'), null);
      assert.equal(h.tab(id), null);
      assert.equal(h.requests().some(request => request.id === id), false);
    } finally { await h.dispose(); }
  });
  const draftEdits = [
    ['name', h => h.fill('#requestName', 'Named draft')],
    ['method', h => h.select('#method', 'POST')],
    ['query key', h => h.fill('[data-param-key="0"]', 'query')],
    ['query value only', h => h.fill('[data-param-value="0"]', 'value without a key')],
    ['header', h => { h.click('[data-builder="Headers"]'); h.fill('[data-header-key="0"]', 'X-Draft'); }],
    ['header value only', h => { h.click('[data-builder="Headers"]'); h.fill('[data-header-value="0"]', 'value without a key'); }],
    ['description', h => { h.click('[data-builder="Docs"]'); h.fill('#description', 'Draft notes'); }],
    ['body', h => { h.click('[data-builder="Body"]'); h.fill('#body', '{"draft":true}'); }],
    ['authorization', h => { h.click('[data-builder="Authorization"]'); h.select('#authType', 'Bearer Token'); h.fill('[data-auth="token"]', 'draft-token'); }],
    ['request settings', h => { h.click('[data-builder="Settings"]'); h.fill('#requestTimeout', '1234'); }],
  ];
  for (const [name, edit] of draftEdits) await test('A draft without a URL still prompts when it has ' + name, async () => {
    const h = await harness();
    try {
      h.click('#newTab'); const id = h.activeId();
      edit(h); h.closeTab(id);
      assert.ok(h.$('.unsaved-modal'), 'A missing URL must not discard other draft content');
      assert.ok(h.tab(id));
      h.click('#cancelUnsaved');
    } finally { await h.dispose(); }
  });
  const storedDraftContent = [
    ['form fields', { bodyType: 'form-data', bodyFields: [{ key: 'field', value: 'draft', enabled: true }] }],
    ['disabled form field content', { bodyType: 'form-data', bodyFields: [{ key: 'field', value: 'draft', enabled: false }] }],
    ['GraphQL query', { bodyType: 'graphql', graphqlQuery: 'query { viewer { id } }', graphqlVariables: '{}' }],
    ['GraphQL variables', { bodyType: 'graphql', graphqlQuery: '', graphqlVariables: '{"id":1}' }],
    ['selected binary file', { bodyType: 'binary', binaryName: 'draft.bin', binaryBytes: [] }],
    ['binary bytes', { bodyType: 'binary', binaryName: '', binaryBytes: [0, 1, 2] }],
    ['pre-request script', { preRequestScript: 'console.log("draft")' }],
    ['test script', { tests: 'pm.test("draft", () => {})' }],
    ['request variables', { variables: [{ key: 'draft', value: 'value', enabled: true }] }],
  ];
  for (const [name, content] of storedDraftContent) await test('A restored draft with an empty URL retains its ' + name, async () => {
    const workspace = fixture(), id = 'restored-draft';
    workspace.collections[0].items.push({ id, name: 'Untitled Request', method: 'GET', url: '', headers: [], params: [], body: '', ...content });
    workspace.editorSession = { requestBaselines: { [id]: null }, openRequestTabs: [id], selectedRequestTab: id };
    const h = await harness(workspace);
    try {
      h.closeTab(id);
      assert.ok(h.$('.unsaved-modal'), 'Hidden or disabled draft content must remain recoverable');
      assert.ok(h.tab(id));
      h.click('#cancelUnsaved');
    } finally { await h.dispose(); }
  });
  await test('Clearing the URL of a saved request still asks to save the change', async () => {
    const h = await harness();
    try {
      h.click('[data-open-request="r-other"]'); h.fill('#url', '');
      h.closeTab('r-other');
      assert.ok(h.$('.unsaved-modal'));
      assert.ok(h.tab('r-other'));
      h.click('#cancelUnsaved');
      assert.equal(h.$('#url').value, '');
    } finally { await h.dispose(); }
  });
  await test('Unchanged saved requests close without prompting after editor navigation', async () => {
    const h = await harness();
    try {
      for (const name of ['Headers', 'Authorization', 'Settings', 'Body', 'Docs', 'Params']) h.click(`[data-builder="${name}"]`);
      h.closeTab('r-original');
      assert.equal(h.$('.unsaved-modal'), null, 'Default normalization and URL encoding are not edits');
      assert.equal(h.tab('r-original'), null);
      h.click('[data-open-request="r-original"]');
      h.fill('#url', 'https://example.test/reopened-edit');
      h.closeTab('r-original');
      assert.ok(h.$('.unsaved-modal'), 'Reopening retains the saved baseline');
      h.click('#cancelUnsaved');
    } finally { await h.dispose(); }
  });
  await test('Imported scripts remain read-only and do not make clean requests dirty', async () => {
    const data = fixture();
    const preRequest = 'pm.environment.set("key", "value");';
    const tests = 'pm.test("preserved", () => {});';
    data.collections[0].items[0].preRequestScript = preRequest;
    data.collections[0].items[0].tests = tests;
    const h = await harness(data);
    try {
      h.click('[data-builder="Scripts"]');
      const preserved = h.$('textarea[aria-label="Preserved scripts"]');
      assert.ok(preserved.readOnly, 'Imported script text cannot imply editing or execution support');
      assert.equal(preserved.value, preRequest + '\n\n' + tests);
      assert.match(h.$('.script-preserved').textContent, /execution is not available/);
      h.closeTab('r-original');
      assert.equal(h.$('.unsaved-modal'), null, 'Viewing imported scripts keeps saved requests clean');
      h.click('[data-open-request="r-other"]');
      assert.equal(h.$('[data-builder="Scripts"]'), null, 'Requests without scripts do not show an inert tab');
      assert.equal(h.requests().find(r => r.id === 'r-original').tests, tests);
      assert.equal(h.requests().find(r => r.id === 'r-original').preRequestScript, preRequest);
    } finally { await h.dispose(); }
  });
  await test('New request Cancel, close icon and Escape preserve the tab and draft', async () => {
    const h = await harness();
    try {
      h.click('#newTab'); const id = h.activeId();
      h.fill('#url', 'https://example.test/draft');
      for (const dismiss of ['#cancelUnsaved', '#closeUnsaved', 'Escape']) {
        h.closeTab(id);
        assert.ok(h.$('.unsaved-modal'));
        if (dismiss === 'Escape') h.escape(); else h.click(dismiss);
        assert.equal(h.$('.unsaved-modal'), null, dismiss + ' dismisses confirmation');
        assert.ok(h.tab(id));
        assert.equal(h.$('#url').value, 'https://example.test/draft');
      }
      h.closeTab(id); h.click('#discardUnsaved'); await flush();
      assert.equal(h.tab(id), null);
      assert.equal(h.requests().some(r => r.id === id), false, 'Discard removes an unsaved request');
    } finally { await h.dispose(); }
  });
  await test('Discard restores a saved request without reverting unrelated requests', async () => {
    const h = await harness();
    try {
      h.fill('#url', 'https://example.test/discard-this');
      h.click('[data-open-request="r-other"]');
      h.fill('#url', 'https://example.test/keep-other-edit');
      h.closeTab('r-original');
      assert.equal(h.activeId(), 'r-other', 'Closing a background tab preserves selection');
      h.click('#discardUnsaved'); await flush();
      assert.equal(h.tab('r-original'), null);
      assert.equal(h.activeId(), 'r-other');
      assert.equal(h.$('#url').value, 'https://example.test/keep-other-edit');
      h.click('[data-open-request="r-original"]');
      assert.equal(new URL(h.$('#url').value).searchParams.get('q'), 'hello world');
      assert.equal(new URL(h.$('#url').value).pathname, '/items');
      h.closeTab('r-original');
      assert.equal(h.$('.unsaved-modal'), null, 'Discarded request is clean when reopened');
    } finally { await h.dispose(); }
  });
  await test('Saving a closing request awaits persistence, selects folder, renames, then closes', async () => {
    const h = await harness();
    try {
      h.click('#newTab'); const id = h.activeId();
      h.fill('#url', 'https://example.test/save-me');
      h.closeTab(id); h.click('#saveUnsaved');
      h.fill('#saveRequestName', 'Saved in chosen folder');
      h.click('[data-save-folder="c-target:f-target"]');
      await flush(); h.holdWrites(); h.click('#confirmSave'); await flush();
      assert.ok(h.tab(id), 'Tab remains open while disk write is pending');
      h.releaseWrites(); await flush();
      assert.equal(h.tab(id), null, 'Tab closes after persistence succeeds');
      assert.equal(h.$('.save-modal'), null);
      const saved = h.snapshot().collections.find(c => c.id === 'c-target').items.find(r => r.id === id);
      assert.ok(saved); assert.equal(saved.name, 'Saved in chosen folder'); assert.equal(saved.folderId, 'f-target');
      h.click(`[data-open-request="${id}"]`); h.closeTab(id);
      assert.equal(h.$('.unsaved-modal'), null, 'Saved request is clean after reopen');
    } finally { await h.dispose(); }
  });
  await test('Closing request Save picker supports creating a collection and folder', async () => {
    const h = await harness();
    try {
      h.click('#newTab'); const id = h.activeId();
      h.fill('#url', 'https://example.test/new-destination');
      h.closeTab(id); h.click('#saveUnsaved');
      h.fill('#saveRequestName', 'New destination request');
      h.click('#newCollection'); h.fill('#entityName', 'Created while saving'); h.click('#entityConfirm');
      assert.ok(h.$('.save-modal'), 'Creating a collection returns to Save picker');
      h.click('#newFolder'); h.fill('#entityName', 'Created folder'); h.click('#entityConfirm');
      assert.equal(h.$('#saveRequestName').value, 'New destination request', 'Destination creation retains request name');
      h.click('#confirmSave'); await flush();
      assert.equal(h.tab(id), null);
      const collection = h.snapshot().collections.find(c => c.name === 'Created while saving');
      assert.ok(collection); const saved = collection.items.find(r => r.id === id);
      assert.ok(saved); assert.equal(saved.name, 'New destination request');
      assert.equal(saved.folderId, collection.folders.find(f => f.name === 'Created folder').id);
    } finally { await h.dispose(); }
  });
  await test('Save failure leaves the request, name and selected folder available for retry', async () => {
    const h = await harness();
    try {
      h.click('#newTab'); const id = h.activeId();
      h.fill('#url', 'https://example.test/retry');
      h.closeTab(id); h.click('#saveUnsaved');
      h.fill('#saveRequestName', 'Retry name'); h.click('[data-save-folder="c-target:f-target"]');
      await flush(); h.failWrites(true); h.click('#confirmSave'); await flush();
      assert.ok(h.tab(id), 'Failed save cannot close the request');
      assert.ok(h.$('.save-modal'), 'Save dialog remains available after failure');
      assert.match(h.$('#saveError')?.textContent || '', /Disk is full/);
      assert.equal(h.$('#saveRequestName').value, 'Retry name');
      assert.ok(h.$('[data-save-folder="c-target:f-target"].selected'));
      h.failWrites(false); h.click('#confirmSave'); await flush();
      assert.equal(h.tab(id), null);
      assert.equal(h.snapshot().collections.find(c => c.id === 'c-target').items.find(r => r.id === id)?.name, 'Retry name');
    } finally { h.failWrites(false); await h.dispose(); }
  });
  await test('Background-tab save cancellation keeps the active request and saves only the chosen tab', async () => {
    const h = await harness();
    try {
      h.select('#url', 'https://example.test/background-edited');
      h.click('[data-open-request="r-other"]');
      h.select('#url', 'https://example.test/active-edited');
      h.closeTab('r-original'); h.click('#saveUnsaved');
      h.fill('#saveRequestName', 'Cancelled name'); h.click('#cancelSave');
      assert.equal(h.activeId(), 'r-other');
      assert.equal(h.$('#url').value, 'https://example.test/active-edited');
      assert.ok(h.tab('r-original'));
      h.closeTab('r-original'); h.click('#saveUnsaved');
      h.fill('#saveRequestName', 'Saved background'); h.click('#confirmSave'); await flush();
      assert.equal(h.tab('r-original'), null); assert.equal(h.activeId(), 'r-other');
      const requests = h.requests();
      assert.equal(requests.find(r => r.id === 'r-original').name, 'Saved background');
      assert.equal(requests.find(r => r.id === 'r-original').url, 'https://example.test/background-edited');
      assert.equal(requests.find(r => r.id === 'r-other').name, 'Other request');
      assert.equal(h.$('#url').value, 'https://example.test/active-edited');
      h.closeTab('r-other'); assert.ok(h.$('.unsaved-modal'), 'Saving another request does not mark active edits saved');
      h.click('#cancelUnsaved');
    } finally { await h.dispose(); }
  });
  await test('Save picker Escape cancels without closing the request', async () => {
    const h = await harness();
    try {
      h.click('#newTab'); const id = h.activeId();
      h.fill('#url', 'https://example.test/escape-save');
      h.closeTab(id); h.click('#saveUnsaved'); h.escape();
      assert.equal(h.$('.save-modal'), null);
      assert.ok(h.tab(id));
      h.closeTab(id); assert.ok(h.$('.unsaved-modal')); h.click('#cancelUnsaved');
    } finally { await h.dispose(); }
  });
  await test('Editing and reverting a saved value clears dirty state', async () => {
    const h = await harness();
    try {
      const original = h.$('#url').value;
      h.fill('#url', 'https://example.test/temporary');
      h.fill('#url', original);
      h.closeTab('r-original');
      assert.equal(h.$('.unsaved-modal'), null);
      assert.equal(h.tab('r-original'), null);
    } finally { await h.dispose(); }
  });
  const edits = [
    ['description', h => { h.click('[data-builder="Docs"]'); h.fill('#description', 'Edited description'); }],
    ['query row', h => { h.fill('[data-param-value="0"]', 'changed'); }],
    ['header', h => { h.click('[data-builder="Headers"]'); h.fill('[data-header-value="0"]', 'text/plain'); }],
    ['body', h => { h.click('[data-builder="Body"]'); h.fill('#body', '{"edited":true}'); }],
    ['authorization', h => { h.click('[data-builder="Authorization"]'); h.select('#authType', 'Bearer Token'); h.fill('[data-auth="token"]', 'edited-token'); }],
    ['request settings', h => { h.click('[data-builder="Settings"]'); h.fill('#requestTimeout', '1234'); }],
  ];
  for (const [name, edit] of edits) await test('Closing prompts after changing ' + name, async () => {
    const h = await harness();
    try { edit(h); h.closeTab('r-original'); assert.ok(h.$('.unsaved-modal')); h.click('#cancelUnsaved'); }
    finally { await h.dispose(); }
  });
  await test('Reload preserves new draft status and the baseline for modified saved requests', async () => {
    let workspace, storage, draftId;
    const first = await harness();
    try {
      first.fill('#url', 'https://example.test/modified-before-reload');
      first.click('#newTab'); draftId = first.activeId();
      first.fill('#url', 'https://example.test/draft-before-reload');
      first.click('[data-open-request="r-other"]'); await flush();
      workspace = first.snapshot(); storage = first.storageSnapshot();
    } finally { await first.dispose(); }
    const h = await harness(workspace, storage);
    try {
      if (!h.tab(draftId)) h.click(`[data-open-request="${draftId}"]`);
      h.closeTab(draftId); assert.ok(h.$('.unsaved-modal'), 'Reloaded new draft remains unsaved');
      h.click('#discardUnsaved'); await flush();
      if (!h.tab('r-original')) h.click('[data-open-request="r-original"]');
      h.closeTab('r-original'); assert.ok(h.$('.unsaved-modal'), 'Reloaded saved edits remain unsaved');
      h.click('#discardUnsaved'); await flush();
      h.click('[data-open-request="r-original"]');
      assert.equal(new URL(h.$('#url').value).pathname, '/items', 'Discard after restart restores the last explicit save');
    } finally { await h.dispose(); }
  });
  await test('Request save keeps collection order and imported body field metadata', async () => {
    const data = fixture();
    data.collections[0].items[0].bodyType = 'form-data';
    data.collections[0].items[0].bodyFields = [{ key:'upload', value:'example.bin', enabled:true, description:'file metadata', type:'file', src:'/not-read/example.bin' }];
    const h = await harness(data);
    try {
      h.click('[data-builder="Body"]'); h.click('#save'); h.click('#confirmSave'); await flush();
      const items = h.snapshot().collections[0].items;
      assert.deepEqual(items.map(r=>r.id), ['r-original','r-other'], 'Save keeps the original request position');
      assert.equal(items[0].bodyFields[0].type, 'file');
      assert.equal(items[0].bodyFields[0].src, '/not-read/example.bin');
      h.closeTab('r-original'); assert.equal(h.$('.unsaved-modal'), null);
    } finally { await h.dispose(); }
  });
  await test('Always discard preference applies to later tab closes', async () => {
    const h = await harness();
    try {
      h.click('#newTab'); const first = h.activeId(); h.fill('#url', 'https://example.test/first-discard'); h.closeTab(first);
      h.click('#alwaysDiscardUnsaved'); h.click('#discardUnsaved');
      h.click('#newTab'); const second = h.activeId(); h.fill('#url', 'https://example.test/auto-discard');
      h.closeTab(second); await flush();
      assert.equal(h.$('.unsaved-modal'), null); assert.equal(h.tab(second), null);
      assert.equal(h.requests().some(r => r.id === second), false);
      assert.ok(Object.values(h.storageSnapshot()).includes('true'), 'Preference persists locally');
    } finally { await h.dispose(); }
  });
  if (failures.length) throw Error(failures.length + ' unsaved-close regression case(s) failed');
  process.stdout.write('PASS: all ' + checks.length + ' unsaved-close regression cases\n');
})().catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
