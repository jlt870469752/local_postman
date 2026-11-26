const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = process.env.POSTMAN_TEST_ROOT || path.resolve(__dirname, '..');
const { JSDOM, VirtualConsole } = require(path.join(root, 'node_modules/jsdom'));

const fixtures = existing => ({
  collections: [{ id: 'c-test', name: 'Regression APIs', folders: [], items: [
    { id: 'r-test', name: 'Initial request', method: 'GET', url: 'http://example.test/original', headers: [], params: [], body: '', bodyType: 'none' },
  ] }],
  environments: [], history: [],
  mockServers: existing ? [{ id: 'm-test', name: 'Saved regression mock', port: 0, routes: [
    { method: 'GET', path: '/saved', status: 200, body: '{"saved":true}', headers: { 'Content-Type': 'application/json' }, delay_ms: 0 },
  ] }] : [],
});
const nextTick = () => new Promise(resolve => setImmediate(resolve));
async function harness(existing = false) {
  const errors = [];
  const console = new VirtualConsole();
  console.on('jsdomError', error => errors.push(error.message));
  const dom = new JSDOM('<div id="app"></div>', { runScripts: 'outside-only', url: 'http://localhost/', virtualConsole: console });
  const w = dom.window;
  w.TextEncoder = TextEncoder;
  let saved;
  w.testInvoke = async (command, args) => {
    if (command === 'load_workspace') return structuredClone(fixtures(existing));
    if (command === 'save_workspace') { saved = JSON.parse(JSON.stringify(args.workspace)); return; }
    if (command === 'git_status') return 'main';
    if (command === 'mock_status') return [];
    if (command === 'mock_start') return { id: args.config.id, port: 51234, logs: [] };
    if (command === 'mock_stop') return;
    throw Error('Unexpected invoke in Mock tab test: ' + command);
  };
  const modules = ['src/assets/postman-icons.js', 'src/import-request.js', 'src/import-collection.js', 'src/code-snippets.js']
    .map(file => fs.readFileSync(path.join(root, file), 'utf8').replace(/^export /gm, '')).join('\n');
  const source = fs.readFileSync(path.join(root, 'src/app.js'), 'utf8')
    .replace(/^import .*;\s*$/gm, '')
    .replace(/^const seed=/m, 'const seed=');
  w.eval('const invoke=window.testInvoke;\n' + modules + '\n' + source);
  await nextTick();
  const $ = selector => w.document.querySelector(selector);
  const all = selector => [...w.document.querySelectorAll(selector)];
  const click = target => {
    const element = typeof target === 'string' ? $(target) : target;
    assert.ok(element, 'Missing control: ' + target);
    element.click();
  };
  const fill = (selector, value) => {
    assert.ok($(selector), 'Missing field: ' + selector);
    $(selector).value = value;
    $(selector).dispatchEvent(new w.Event('input', { bubbles: true }));
  };
  const tabs = () => all('.tabs-scroll .request-tab, .tabbar [role="tab"]')
    .filter((tab, i, list) => list.indexOf(tab) === i);
  const tab = name => tabs().find(element => element.textContent.includes(name));
  const active = () => tabs().find(element => element.getAttribute('aria-selected') === 'true' || element.classList.contains('selected'));
  const close = element => {
    assert.ok(element, 'Tab to close must exist');
    const button = element.querySelector('[data-close-tab], .tab-close, [aria-label^="Close"], [id^="closeMock"]');
    assert.ok(button, 'Tab needs its own close control');
    click(button);
  };
  const create = () => click($('#createMockEmpty') || $('#createMock') || all('.sidebar button').find(b => b.textContent.trim() === 'Create'));
  const noSidebarForm = () => {
    assert.equal($('.sidebar .mock-detail, .sidebar .mock-editor, .sidebar .deploy-page, .sidebar textarea, .sidebar select'), null,
      'Mock create/detail editors must never render inside the sidebar');
    assert.equal($('.sidebar #mockPort, .sidebar #mockBody, .sidebar #deployMockName'), null,
      'Mock fields belong in the workspace canvas');
  };
  const clean = () => assert.deepEqual(errors, [], 'Mock navigation must not throw event-handler errors');
  return { w, dom, $, all, click, fill, tabs, tab, active, close, create, noSidebarForm, clean, saved: () => saved };
}

(async () => {
  const checks = [];
  const failures = [];
  const test = async (name, run) => {
    try { await run(); checks.push(name); process.stdout.write('PASS: ' + name + '\n'); }
    catch (error) { failures.push({ name, error }); process.stderr.write('FAIL: ' + name + '\n' + error.stack + '\n'); }
  };
  await test('Create opens one workspace tab, never a sidebar form or modal', async () => {
    const h = await harness();
    try {
      h.fill('#url', 'http://example.test/request-edit');
      h.click('[data-view="services"]');
      h.noSidebarForm();
      assert.ok(h.$('#createMockEmpty'), 'Empty Mock Servers offers Create');
      const before = h.tabs().length;
      h.create();
      assert.ok(h.$('.canvas #deployMockName'), 'Create renders its form in the main workspace');
      assert.equal(h.$('.modal-backdrop, .deploy-modal'), null, 'Mock creation uses a tab, not a modal');
      h.noSidebarForm();
      assert.equal(h.tabs().length, before + 1, 'Create adds exactly one tab');
      assert.match(h.active()?.textContent || '', /Deploy mock server/);
      h.fill('#deployMockName', 'Draft mock name');
      h.click(h.tab('Initial request'));
      assert.equal(h.$('#url')?.value, 'http://example.test/request-edit', 'Request edits survive the Mock tab');
      h.click(h.tab('Deploy mock server'));
      assert.equal(h.$('.canvas #deployMockName')?.value, 'Draft mock name', 'Mock draft survives switching requests');
      h.create();
      assert.equal(h.tabs().length, before + 1, 'Repeated Create focuses the existing draft tab');
      assert.equal(h.$('#deployMockName')?.value, 'Draft mock name', 'Repeated Create preserves the draft');
      h.close(h.tab('Deploy mock server'));
      assert.equal(h.tab('Deploy mock server'), undefined, 'Close removes only the Mock tab');
      assert.equal(h.$('#requestName')?.value, 'Initial request', 'Closing the Mock tab restores its neighboring request');
      h.clean();
    } finally { await nextTick(); h.dom.window.close(); }
  });
  await test('Existing Mock Servers open and retain details in workspace tabs', async () => {
    const h = await harness(true);
    try {
      h.click('[data-view="services"]');
      h.noSidebarForm();
      assert.ok(h.$('#createMock'), 'Saved Mock list retains a visible Create control');
      h.click('#createMock');
      assert.ok(h.$('.canvas #deployMockName'), 'Create with saved mocks opens a workspace tab');
      h.close(h.tab('Deploy mock server'));
      h.click('[data-mock-select="m-test"]');
      h.noSidebarForm();
      assert.ok(h.$('.canvas #mockPort, .canvas .mock-detail, .canvas .mock-detail-page, .canvas .mock-server-page'), 'Saved mock detail opens in the workspace');
      assert.ok(h.tab('Saved regression mock'), 'Saved mock has its own named workspace tab');
      if (h.$('#mockPath')) h.fill('#mockPath', '/edited-in-tab');
      h.click(h.tab('Initial request'));
      h.noSidebarForm();
      assert.equal(h.$('#requestName')?.value, 'Initial request');
      h.click('[data-mock-select="m-test"]');
      assert.equal(h.tabs().filter(t => t.textContent.includes('Saved regression mock')).length, 1, 'Reopening a mock focuses its tab');
      if (h.$('#mockPath')) assert.equal(h.$('#mockPath').value, '/edited-in-tab', 'Saved mock edits survive switching');
      h.click('#newTab');
      assert.ok(h.tab('Saved regression mock'), 'Creating an HTTP request preserves the Mock tab');
      const newRequestTab = h.active();
      h.click(h.tab('Saved regression mock'));
      h.close(h.tab('Saved regression mock'));
      assert.equal(h.$('#requestName')?.value, 'Initial request', 'Closing a middle Mock tab chooses its left neighbor');
      assert.ok(h.tabs().some(t => t.textContent.includes('Untitled Request')), 'Closing Mock keeps the other request open');
      h.noSidebarForm();
      h.clean();
    } finally { await nextTick(); h.dom.window.close(); }
  });
  await test('All Services sections collapse into consecutive headers at the top', async () => {
    const h = await harness(true);
    try {
      const style = h.w.document.createElement('style');
      style.textContent = fs.readFileSync(path.join(root, 'src/styles.css'), 'utf8');
      h.w.document.head.append(style);
      h.click('[data-view="services"]');
      const mockToggle = '[data-service-toggle="mocks"]';
      assert.equal(h.$(mockToggle).getAttribute('aria-expanded'), 'true');
      h.click('[data-mock-select="m-test"]');
      h.click(mockToggle);
      assert.equal(h.$(mockToggle).getAttribute('aria-expanded'), 'false');
      assert.equal(h.$('.sidebar .mock-panel'), null, 'Collapsed Mock hides its list and Create button');
      assert.ok(h.tab('Saved regression mock'), 'Collapse keeps an open Mock workspace tab');
      const toggles = h.all('.service-groups [data-service-toggle]');
      assert.deepEqual(toggles.map(button => button.dataset.serviceToggle), ['mocks', 'monitors', 'webhooks', 'flows']);
      assert.ok(toggles.every(button => button.getAttribute('aria-expanded') === 'false'), 'All four headers can be collapsed');
      const css = element => h.w.getComputedStyle(element);
      assert.equal(css(h.$('.service-primary')).flexGrow, '0', 'Collapsed Mock section must not absorb sidebar space');
      assert.equal(css(h.$('.service-secondary')).marginTop, '0px', 'Other groups must not be pushed to the bottom');
      assert.equal(css(h.$('.service-groups')).overflowY, 'auto', 'Expanded groups share a scrollable sidebar');
      assert.equal(css(h.$('.service-primary > .service-group')).height, css(h.$('.secondary-service .service-group')).height,
        'All collapsed groups use the same row height');
      h.click('[data-service-toggle="monitors"]');
      assert.equal(h.$('[data-service-toggle="monitors"]').getAttribute('aria-expanded'), 'true');
      assert.equal(h.$(mockToggle).getAttribute('aria-expanded'), 'false', 'Other groups expand independently');
      h.click('[data-service-toggle="monitors"]');
      h.click('[data-view="collections"]');
      h.click('[data-view="services"]');
      assert.equal(h.$(mockToggle).getAttribute('aria-expanded'), 'false', 'Switching panels retains collapse state');
      h.click(mockToggle);
      assert.ok(h.$('[data-mock-select="m-test"]'), 'Expanding Mock restores saved server rows');
      assert.ok(h.$('#createMock'), 'Expanding Mock restores Create');
      h.clean();
    } finally { await nextTick(); h.dom.window.close(); }
  });
  await test('Request code panel is suspended while a Mock tab is active', async () => {
    const h = await harness();
    try {
      h.click('#codeSnippet');
      assert.ok(h.$('.code-snippet-panel'), 'Request code panel opens');
      h.click('[data-view="services"]');
      h.create();
      assert.equal(h.$('.code-snippet-panel'), null, 'Request code must not cover the Mock workspace');
      assert.equal(h.$('.shell.has-code-snippet'), null, 'Mock workspace retains its full width');
      h.click(h.tab('Initial request'));
      assert.ok(h.$('.code-snippet-panel'), 'Returning to the request restores its code panel');
      h.clean();
    } finally { await nextTick(); h.dom.window.close(); }
  });
  if (failures.length) throw new Error(failures.length + ' Mock tab regression case(s) failed');
  process.stdout.write('PASS: all ' + checks.length + ' Mock workspace tab flows\n');
})().catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
