const fs = require('node:fs');
const assert = require('node:assert/strict');
const test = require('node:test');
const { JSDOM, VirtualConsole } = require('jsdom');
const tick = () => new Promise(resolve => setImmediate(resolve));

async function harness() {
  const errors = [], vc = new VirtualConsole();
  vc.on('jsdomError', error => errors.push(error.message));
  const dom = new JSDOM('<div id="app"></div>', { url: 'http://localhost/', runScripts: 'outside-only', virtualConsole: vc });
  const w = dom.window; w.TextEncoder = TextEncoder;
  const workspace = { collections: [{ id: 'c', name: 'Local APIs', folders: [], items: [{ id: 'a', name: 'Original name', method: 'GET', url: 'http://example.test/a', headers: [], params: [], body: '' }] }], environments: [], history: [] };
  let saved;
  w.testInvoke = async (command, args) => {
    if (command === 'load_workspace') return structuredClone(workspace);
    if (command === 'save_workspace') { saved = structuredClone(args.workspace); return; }
    if (command === 'workspace_list') return [{ id: 'default', name: 'My Workspace', active: true }];
    if (command === 'git_status') return 'main';
    if (command === 'mock_status' || command === 'service_status') return [];
    throw Error('Unexpected invoke: ' + command);
  };
  const modules = ['src/assets/postman-icons.js', 'src/import-request.js', 'src/import-collection.js', 'src/code-snippets.js'].map(file => fs.readFileSync(file, 'utf8').replace(/^export /gm, '')).join('\n');
  w.eval('const invoke=window.testInvoke;\n' + modules + '\n' + fs.readFileSync('src/app.js', 'utf8').replace(/^import .*;\s*$/gm, ''));
  for (let i = 0; i < 5; i++) await tick();
  const $ = selector => w.document.querySelector(selector);
  const input = () => $('#requestName');
  const type = value => { input().value = value; input().dispatchEvent(new w.Event('input', { bubbles: true })); };
  const key = value => input().dispatchEvent(new w.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }));
  return { w, $, input, type, key, snapshot: () => saved,
    async close() { await tick(); assert.deepEqual(errors, []); w.close(); } };
}

test('Request name enters an inline input on focus and Enter confirms the new title everywhere', async () => {
  const h = await harness();
  try {
    assert.equal(h.input().readOnly, true);
    h.input().focus();
    assert.equal(h.input().readOnly, false);
    assert.equal(h.input().classList.contains('is-editing'), true);
    assert.equal(h.input().selectionStart, 0);
    assert.equal(h.input().selectionEnd, 'Original name'.length);
    h.type('  Renamed request  ');
    assert.equal(h.$('.tab-title').textContent, 'Original name', 'The draft waits for confirmation');
    h.key('Enter');
    assert.equal(h.input().value, 'Renamed request');
    assert.equal(h.input().readOnly, true);
    assert.equal(h.$('.tab-title').textContent, 'Renamed request');
    assert.equal(h.$('[data-open-request="a"] .tree-label').textContent, 'Renamed request');
    assert.equal(h.$('[data-select-tab="a"]').title, 'Renamed request');
    assert.equal(h.$('[data-close-tab="a"]').getAttribute('aria-label'), 'Close Renamed request');
    assert.equal(h.$('[data-select-tab="a"]').classList.contains('is-dirty'), true);
    h.$('[data-builder="Body"]').click();
    assert.equal(h.snapshot().collections[0].items[0].name, 'Renamed request');
  } finally { await h.close(); }
});

test('Escape cancels a request title draft, blur confirms it, and an empty title preserves the previous name', async () => {
  const h = await harness();
  try {
    h.input().focus(); h.type('Cancelled title'); h.key('Escape');
    assert.equal(h.input().value, 'Original name');
    assert.equal(h.$('.tab-title').textContent, 'Original name');
    assert.equal(h.$('[data-select-tab="a"]').classList.contains('is-dirty'), false);
    h.input().click(); h.input().focus(); h.type('Blur title'); h.input().blur();
    assert.equal(h.input().readOnly, true);
    assert.equal(h.$('.tab-title').textContent, 'Blur title');
    h.input().focus(); h.type('   '); h.key('Enter');
    assert.equal(h.input().value, 'Blur title');
    assert.equal(h.$('.tab-title').textContent, 'Blur title');
  } finally { await h.close(); }
});
