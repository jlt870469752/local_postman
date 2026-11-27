const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = process.env.POSTMAN_TEST_ROOT || path.resolve(__dirname, '..');
const { JSDOM, VirtualConsole } = require(path.join(root, 'node_modules/jsdom'));
const tick = () => new Promise(resolve => setImmediate(resolve));
const request = (id, name, folderId = null) => ({ id, name, folderId, method: 'GET', url: 'http://example.test/' + id, headers: [], params: [], body: '', bodyType: 'none' });
const fixture = () => ({ collections: [
  { id: 'c-one', name: 'First collection', description: 'Original collection', folders: [
    { id: 'f-root', name: 'Parent folder', parentId: null },
    { id: 'f-child', name: 'Child folder', parentId: 'f-root' },
    { id: 'f-sibling', name: 'Sibling folder', parentId: null },
  ], items: [request('r-root', 'Root request'), request('r-parent', 'Parent request', 'f-root'), request('r-deep', 'Needle request', 'f-child'), request('r-sibling', 'Sibling request', 'f-sibling')] },
  { id: 'c-two', name: 'Second collection', folders: [{ id: 'f-target', name: 'Destination', parentId: null }], items: [request('r-other', 'Other request')] },
], environments: [], history: [], mockServers: [] });

async function harness(workspace = fixture()) {
  const errors = [], vc = new VirtualConsole();
  vc.on('jsdomError', error => errors.push(error.message));
  const dom = new JSDOM('<div id="app"></div>', { url: 'http://localhost/', runScripts: 'outside-only', virtualConsole: vc });
  const w = dom.window;
  w.TextEncoder = TextEncoder;
  let saved;
  w.testInvoke = async (command, args) => {
    if (command === 'load_workspace') return structuredClone(workspace);
    if (command === 'save_workspace') { saved = JSON.parse(JSON.stringify(args.workspace)); return; }
    if (command === 'git_status') return 'main';
    if (command === 'send_request') return { ok: true, status: 200, body: '{}', time_ms: 1, headers: {}, size: 2 };
    if (command === 'mock_status') return [];
    throw new Error('Unexpected invoke: ' + command);
  };
  const modules = ['src/assets/postman-icons.js', 'src/import-request.js', 'src/import-collection.js', 'src/code-snippets.js']
    .map(file => fs.readFileSync(path.join(root, file), 'utf8').replace(/^export /gm, '')).join('\n');
  const source = fs.readFileSync(path.join(root, 'src/app.js'), 'utf8').replace(/^import .*;\s*$/gm, '');
  w.eval('const invoke=window.testInvoke;\n' + modules + '\n' + source);
  await tick();
  const $ = selector => w.document.querySelector(selector);
  const all = selector => [...w.document.querySelectorAll(selector)];
  const click = target => { const el = typeof target === 'string' ? $(target) : target; assert.ok(el, 'Missing control: ' + target); el.click(); };
  const fill = (selector, value) => { const el = $(selector); assert.ok(el, 'Missing field: ' + selector); el.value = value; el.dispatchEvent(new w.Event('input', { bubbles: true })); };
  const select = (selector, value) => { fill(selector, value); $(selector).dispatchEvent(new w.Event('change', { bubbles: true })); };
  const row = (kind, id) => $(`.tree-row[data-entity-kind="${kind}"][data-entity-id="${id}"]`);
  const reveal = id => { const c = snapshot().collections.find(c => c.folders.some(f => f.id === id)); if (!c) return; const parents = []; let f = c.folders.find(f => f.id === id); while (f) { parents.unshift(f.id); f = c.folders.find(parent => parent.id === f.parentId); } for (const folderId of parents) if ($(`[data-toggle-folder="${folderId}"]`)?.getAttribute('aria-expanded') === 'false') click(`[data-toggle-folder="${folderId}"]`); };
  const action = (kind, id, name) => { if (kind === 'folder') { const folder = snapshot().collections.flatMap(c => c.folders).find(f => f.id === id); if (folder?.parentId) reveal(folder.parentId); } if (kind === 'request') { const request = snapshot().collections.flatMap(c => c.items).find(r => r.id === id); if (request?.folderId) reveal(request.folderId); } assert.ok(row(kind, id), `Missing ${kind} ${id}`); click(row(kind, id).querySelector('[data-tree-menu]')); click(`[data-tree-action="${name}"]`); };
  const confirm = () => click('#entityConfirm');
  const snapshot = () => JSON.parse(JSON.stringify(saved ?? workspace));
  const collection = id => snapshot().collections.find(c => c.id === id);
  const close = async () => { await tick(); assert.deepEqual(errors, [], 'UI event handlers must not throw'); dom.window.close(); };
  return { w, dom, $, all, click, fill, select, row, action, confirm, snapshot, collection, reveal, errors, close };
}

(async () => {
  const checks = [], failures = [];
  const test = async (name, run) => { try { await run(); checks.push(name); console.log('PASS: ' + name); } catch (error) { failures.push(name); console.error('FAIL: ' + name + '\n' + error.stack); } };
  await test('Collections starts expanded, can collapse, and folders start closed until explicitly expanded', async () => {
    const h = await harness();
    try {
      assert.equal(h.$('#toggleCollections').getAttribute('aria-expanded'), 'true');
      assert.equal(h.$('[data-toggle-collection="c-one"]').getAttribute('aria-expanded'), 'true');
      assert.equal(h.$('[data-toggle-folder="f-root"]').getAttribute('aria-expanded'), 'false');
      assert.equal(h.$('[data-toggle-folder="f-sibling"]').getAttribute('aria-expanded'), 'false');
      assert.equal(h.row('folder', 'f-child'), null); assert.equal(h.row('request', 'r-parent'), null);
      h.click('#toggleCollections');
      assert.equal(h.$('#toggleCollections').getAttribute('aria-expanded'), 'false');
      assert.equal(h.$('#collectionsTree'), null);
      h.click('[data-builder="Headers"]');
      assert.equal(h.$('#toggleCollections').getAttribute('aria-expanded'), 'false', 'A render does not reopen the section');
      h.click('#toggleCollections'); h.click('[data-toggle-folder="f-root"]');
      assert.ok(h.row('request', 'r-parent'));
      assert.equal(h.$('[data-toggle-folder="f-child"]').getAttribute('aria-expanded'), 'false');
      h.click('[data-toggle-folder="f-child"]'); assert.ok(h.row('request', 'r-deep'));
      h.click('[data-toggle-folder="f-root"]'); h.click('[data-builder="Body"]');
      assert.equal(h.row('request', 'r-parent'), null, 'Manual collapse survives editor navigation');
      h.fill('#sidebarFilter', 'Needle'); assert.ok(h.row('request', 'r-deep'));
      h.fill('#sidebarFilter', ''); assert.equal(h.row('request', 'r-deep'), null, 'Search does not permanently open folders');
      h.click('#toggleCollections'); h.click('[data-view="history"]'); h.click('[data-view="collections"]');
      assert.equal(h.$('#toggleCollections').getAttribute('aria-expanded'), 'false', 'View switching retains the section state');
      assert.equal(h.snapshot().collections[0].items.length, 4, 'Collapse never removes collection contents');
    } finally { await h.close(); }
  });
  await test('Collections toggles once after URL edits and parameter editor rebinding', async () => {
    const h = await harness();
    try {
      h.fill('#url', 'http://example.test/updated?one=1');
      h.click('#toggleCollections');
      assert.equal(h.$('#toggleCollections').getAttribute('aria-expanded'), 'false', 'Editing URL must not attach a second toggle listener');
      assert.equal(h.$('#collectionsTree'), null);
      h.click('#toggleCollections');
      assert.equal(h.$('#toggleCollections').getAttribute('aria-expanded'), 'true');
      h.click('[data-add-row="param"]');
      h.fill('#url', 'http://example.test/updated?one=1&two=2');
      h.fill('#url', 'http://example.test/updated?one=1&two=2&three=3');
      h.click('#toggleCollections');
      assert.equal(h.$('#collectionsTree'), null, 'Repeated editor rebinding must not cancel a collapse');
      h.click('#toggleCollections');
      assert.ok(h.$('#collectionsTree'));
      assert.equal(h.$('#url').value, 'http://example.test/updated?one=1&two=2&three=3');
    } finally { await h.close(); }
  });
  await test('Environments follows the Collections header when Collections is collapsed', async () => {
    const data = fixture(); data.environments = [{ id: 'local', name: 'Local', values: {} }];
    const h = await harness(data);
    try {
      assert.equal(h.$('.sidebar').classList.contains('collections-collapsed'), false);
      h.click('#toggleCollections');
      assert.ok(h.$('.sidebar').classList.contains('collections-collapsed'));
      assert.equal(h.$('.sidebar-title').nextElementSibling, h.$('.side-sections'));
      h.click('[data-section="Environments"]');
      assert.ok(h.$('[data-edit-env="local"]'));
      assert.ok(h.$('.sidebar').classList.contains('collections-collapsed'));
      h.click('#toggleCollections');
      assert.equal(h.$('.sidebar').classList.contains('collections-collapsed'), false);
      assert.ok(h.$('#collectionsTree'));
      assert.equal(h.$('[data-section="Environments"]').getAttribute('aria-expanded'), 'true');
    } finally { await h.close(); }
  });
  await test('Collection create, edit, rename, cancellation and duplicate are persisted', async () => {
    const h = await harness();
    try {
      assert.equal(h.$('#importCollection'), null, 'Redundant title import is removed');
      assert.ok(h.$('#importWorkspace'), 'Top import stays available');
      h.click('#addCollection'); h.fill('#entityName', 'New APIs'); h.confirm();
      const id = h.snapshot().collections.find(c => c.name === 'New APIs').id;
      h.action('collection', id, 'rename'); h.fill('#entityName', 'Discarded'); h.click('#entityCancel');
      assert.equal(h.collection(id).name, 'New APIs');
      h.action('collection', id, 'rename'); h.fill('#entityName', 'Renamed APIs'); h.confirm();
      assert.equal(h.collection(id).name, 'Renamed APIs');
      h.action('collection', id, 'edit'); h.fill('#entityName', 'Edited APIs'); h.fill('#entityDescription', 'Local API collection'); h.confirm();
      assert.equal(h.collection(id).description, 'Local API collection');
      h.action('collection', 'c-one', 'duplicate');
      const duplicate = h.snapshot().collections.find(c => c.name === 'First collection Copy');
      assert.equal(duplicate.items.length, 4); assert.equal(duplicate.folders.length, 3);
      const originalIds = new Set(['c-one', 'f-root', 'f-child', 'f-sibling', 'r-root', 'r-parent', 'r-deep', 'r-sibling']);
      for (const item of [duplicate, ...duplicate.items, ...duplicate.folders]) assert.ok(!originalIds.has(item.id), 'Duplicates must use new IDs');
      const child = duplicate.folders.find(f => f.name === 'Child folder'), parent = duplicate.folders.find(f => f.name === 'Parent folder');
      assert.equal(child.parentId, parent.id); assert.equal(duplicate.items.find(r => r.name === 'Needle request').folderId, child.id);
      h.action('collection', id, 'delete'); h.click('#entityCancel'); assert.ok(h.collection(id));
      h.action('collection', id, 'delete'); h.confirm(); assert.equal(h.collection(id), undefined);
      h.click('#undoDeletion'); assert.equal(h.collection(id).name, 'Edited APIs');
    } finally { await h.close(); }
  });
  await test('Nested folders and targeted requests support CRUD and content editing', async () => {
    const h = await harness();
    try {
      h.action('collection', 'c-two', 'add-folder'); h.fill('#entityName', 'New parent'); h.confirm();
      const parent = h.collection('c-two').folders.find(f => f.name === 'New parent');
      h.action('folder', parent.id, 'add-folder'); h.fill('#entityName', 'New child'); h.confirm();
      const child = h.collection('c-two').folders.find(f => f.name === 'New child'); assert.equal(child.parentId, parent.id);
      h.action('folder', child.id, 'rename'); h.fill('#entityName', 'Renamed child'); h.confirm();
      h.action('folder', child.id, 'add-request');
      const created = h.collection('c-two').items.find(r => r.name === 'Untitled Request'); assert.equal(created.folderId, child.id);
      h.fill('#url', 'http://example.test/edited'); h.fill('#requestName', 'Edited request');
      h.click('[data-builder="Body"]'); h.click('[name="bodyType"][value="raw"]'); h.fill('#body', '{"edited":true}');
      h.click('[data-open-request="r-root"]');
      h.click(`[data-open-request="${created.id}"]`);
      assert.equal(h.$('#url').value, 'http://example.test/edited'); assert.equal(h.$('#requestName').value, 'Edited request'); assert.equal(h.$('#body').value, '{"edited":true}');
      h.action('request', created.id, 'rename'); h.fill('#entityName', 'Tree renamed request'); h.confirm();
      assert.equal(h.collection('c-two').items.find(r => r.id === created.id).name, 'Tree renamed request');
      h.click(`[data-toggle-folder="${parent.id}"]`); assert.equal(h.row('request', created.id), null);
      h.click(`[data-toggle-folder="${parent.id}"]`); assert.ok(h.row('request', created.id));
      h.action('folder', parent.id, 'delete'); h.confirm();
      assert.equal(h.collection('c-two').folders.some(f => [parent.id, child.id].includes(f.id)), false);
      assert.equal(h.collection('c-two').items.some(r => r.id === created.id), false);
      assert.equal(h.$(`[data-select-tab="${created.id}"]`), null);
      assert.ok(h.collection('c-one').items.some(r => r.id === 'r-root'));
      h.click('#undoDeletion'); assert.ok(h.row('folder', child.id)); assert.ok(h.row('request', created.id));
    } finally { await h.close(); }
  });
  await test('Requests and folder subtrees move across collections without losing contents', async () => {
    const h = await harness();
    try {
      h.action('request', 'r-root', 'duplicate');
      const copy = h.collection('c-one').items.find(r => r.name === 'Root request Copy'); assert.notEqual(copy.id, 'r-root');
      h.action('request', copy.id, 'move'); h.select('#entityDestination', 'c-two:f-target'); h.confirm();
      assert.equal(h.collection('c-one').items.some(r => r.id === copy.id), false);
      assert.equal(h.collection('c-two').items.find(r => r.id === copy.id).folderId, 'f-target');
      h.action('folder', 'f-root', 'move');
      assert.equal([...h.$('#entityDestination').options].some(o => o.value === 'c-one:f-child'), false, 'Descendants cannot be destinations');
      h.select('#entityDestination', 'c-two:f-target'); h.confirm();
      assert.equal(h.collection('c-one').folders.some(f => f.id === 'f-root' || f.id === 'f-child'), false);
      assert.equal(h.collection('c-one').items.some(r => r.id === 'r-deep'), false);
      assert.equal(h.collection('c-two').folders.find(f => f.id === 'f-root').parentId, 'f-target');
      assert.equal(h.collection('c-two').folders.find(f => f.id === 'f-child').parentId, 'f-root');
      assert.equal(h.collection('c-two').items.find(r => r.id === 'r-deep').folderId, 'f-child');
    } finally { await h.close(); }
  });
  await test('Deleting an active request or collection keeps valid neighboring tabs and allows undo', async () => {
    const h = await harness();
    try {
      h.fill('#url', 'http://example.test/root-keep');
      h.reveal('f-child'); h.click('[data-open-request="r-deep"]'); h.click('[data-open-request="r-other"]');
      h.action('request', 'r-other', 'delete'); h.confirm();
      assert.equal(h.$('#requestName').value, 'Needle request'); assert.equal(h.$('[data-select-tab="r-other"]'), null);
      assert.equal(h.collection('c-one').items.find(r => r.id === 'r-root').url, 'http://example.test/root-keep');
      h.action('collection', 'c-one', 'delete'); h.confirm();
      assert.equal(h.$('#requestName'), null); assert.ok(h.$('.workspace-empty'));
      assert.equal(h.all('[data-select-tab]').length, 0); assert.equal(h.collection('c-one'), undefined);
      h.click('#undoDeletion'); assert.equal(h.$('#requestName').value, 'Needle request'); assert.ok(h.$('[data-select-tab="r-root"]'));
    } finally { await h.close(); }
  });
  await test('Deleting the final request leaves an empty workspace and reload does not recreate data', async () => {
    const data = { collections: [{ id: 'c-last', name: 'Last collection', folders: [], items: [request('r-last', 'Last request')] }], environments: [], history: [], mockServers: [] };
    const h = await harness(data); let saved;
    try {
      h.action('request', 'r-last', 'delete'); h.confirm();
      assert.ok(h.$('.workspace-empty')); assert.equal(h.$('#requestName'), null); assert.equal(h.collection('c-last').items.length, 0); saved = h.snapshot();
    } finally { await h.close(); }
    const reloaded = await harness(saved);
    try {
      assert.ok(reloaded.$('.workspace-empty')); assert.equal(reloaded.collection('c-last').items.length, 0);
      reloaded.click('#newTab'); assert.equal(reloaded.collection('c-last').items.length, 1);
      reloaded.action('collection', 'c-last', 'delete'); reloaded.confirm(); assert.deepEqual(reloaded.snapshot().collections, []);
      reloaded.click('#newTab'); assert.equal(reloaded.snapshot().collections.length, 1); assert.equal(reloaded.snapshot().collections[0].items.length, 1);
    } finally { await reloaded.close(); }
  });
  await test('Filtering keeps matching descendants and ancestor path, excluding unrelated items', async () => {
    const h = await harness();
    try {
      h.click('[data-toggle-folder="f-root"]');
      h.fill('#sidebarFilter', 'Needle');
      assert.ok(h.row('collection', 'c-one')); assert.ok(h.row('folder', 'f-root')); assert.ok(h.row('folder', 'f-child')); assert.ok(h.row('request', 'r-deep'));
      assert.equal(h.row('request', 'r-parent'), null); assert.equal(h.row('request', 'r-root'), null); assert.equal(h.row('folder', 'f-sibling'), null); assert.equal(h.row('collection', 'c-two'), null);
      h.fill('#sidebarFilter', 'Parent folder'); assert.ok(h.row('request', 'r-parent')); assert.ok(h.row('request', 'r-deep'));
      h.fill('#sidebarFilter', 'not-found'); assert.equal(h.all('.tree-row').length, 0); assert.match(h.$('.collection-tree').textContent, /No results/);
    } finally { await h.close(); }
  });
  await test('Save initializes each request destination, isolates cancellation and creates named destinations', async () => {
    const h = await harness();
    try {
      h.reveal('f-child'); h.click('[data-open-request="r-deep"]'); h.click('#save');
      assert.ok(h.$('[data-save-folder="c-one:f-child"].selected')); assert.equal(h.$('#confirmSave').disabled, false);
      h.fill('#saveRequestName', 'Cancelled name'); h.click('[data-save-collection="c-two"]'); h.click('#cancelSave');
      assert.equal(h.$('#requestName').value, 'Needle request'); assert.equal(h.collection('c-one').items.find(r => r.id === 'r-deep').name, 'Needle request');
      h.click('#save'); assert.ok(h.$('[data-save-folder="c-one:f-child"].selected')); h.click('#confirmSave'); await tick();
      assert.equal(h.collection('c-one').items.find(r => r.id === 'r-deep').folderId, 'f-child');
      h.click('[data-open-request="r-other"]'); h.click('#save'); assert.ok(h.$('[data-save-collection="c-two"].selected'));
      h.click('#newFolder'); h.fill('#entityName', 'Saved requests'); h.confirm();
      const folder = h.collection('c-two').folders.find(f => f.name === 'Saved requests'); assert.ok(folder);
      h.fill('#saveRequestName', 'Saved other'); h.click('#confirmSave'); await tick(); assert.equal(h.collection('c-two').items.find(r => r.id === 'r-other').folderId, folder.id);
      h.click('#save'); h.click('#newCollection'); h.fill('#entityName', 'Saved collection'); h.confirm();
      const collection = h.snapshot().collections.find(c => c.name === 'Saved collection'); assert.ok(collection);
      h.click('#confirmSave'); await tick(); assert.ok(h.collection(collection.id).items.find(r => r.id === 'r-other')); assert.equal(h.collection('c-two').items.some(r => r.id === 'r-other'), false);
      const reloaded = await harness(h.snapshot());
      try { assert.ok(reloaded.row('collection', collection.id)); assert.ok(reloaded.row('request', 'r-other')); assert.equal(reloaded.collection(collection.id).items[0].name, 'Saved other'); } finally { await reloaded.close(); }
    } finally { await h.close(); }
  });
  await test('Workspace imports remap nested folders and keep requests visible', async () => {
    const h = await harness();
    try {
      h.click('#importWorkspace'); h.fill('#importText', JSON.stringify(fixture())); h.click('#confirmImport');
      assert.equal(h.$('.import-error'), null);
      const c = h.snapshot().collections.filter(c => c.name === 'First collection').at(-1);
      assert.notEqual(c.id, 'c-one');
      const parent = c.folders.find(f => f.name === 'Parent folder'), child = c.folders.find(f => f.name === 'Child folder');
      assert.notEqual(parent.id, 'f-root'); assert.equal(child.parentId, parent.id);
      const deep = c.items.find(r => r.name === 'Needle request'); assert.equal(deep.folderId, child.id);
      assert.equal(h.$(`[data-toggle-folder="${parent.id}"]`).getAttribute('aria-expanded'), 'false');
      assert.equal(h.row('folder', child.id), null); assert.equal(h.row('request', deep.id), null);
      h.reveal(child.id); assert.ok(h.row('request', deep.id));
    } finally { await h.close(); }
  });
  await test('Deleting a request beside Mock tabs selects the corresponding Mock details', async () => {
    const data = fixture();
    data.mockServers = ['A', 'B'].map(name => ({ id: 'mock-' + name, name: 'Mock ' + name, port: 0, routes: [{ method: 'GET', path: '/' + name, status: 200, body: '{}' }] }));
    const h = await harness(data);
    try {
      h.click('[data-view="services"]'); h.click('[data-mock-select="mock-A"]'); h.click('#newTab');
      const created = h.snapshot().collections.flatMap(c => c.items).find(r => r.name === 'Untitled Request');
      h.click('[data-mock-select="mock-B"]'); h.click(`[data-select-tab="${created.id}"]`); h.click('[data-view="collections"]');
      h.action('request', created.id, 'delete'); h.confirm();
      assert.equal(h.$('[data-select-tab="mock:mock-A"]').getAttribute('aria-selected'), 'true');
      assert.equal(h.$('#mockName').value, 'Mock A'); assert.equal(h.$('#mockPath').value, '/A');
    } finally { await h.close(); }
  });
  if (failures.length) { console.error(`${failures.length} collection tests failed`); process.exitCode = 1; }
  else console.log(`PASS: all ${checks.length} collection CRUD flows`);
})().catch(error => { console.error(error); process.exitCode = 1; });
