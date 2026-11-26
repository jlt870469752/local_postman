import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const source = (await readFile(new URL('../src/i18n.js', import.meta.url), 'utf8')).replace(/^export /gm, '');
function harness(html = '') {
  const dom = new JSDOM(html, { runScripts: 'outside-only' });
  dom.window.eval(source + '\nwindow.i18n = {setLanguage,getLanguage,t,translateUi,observeUi};');
  return { dom, w: dom.window, ...dom.window.i18n, $: selector => dom.window.document.querySelector(selector), close: () => dom.window.close() };
}
const settle = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)); };

test('English and Simplified Chinese can be switched without losing original labels or markup', () => {
  const h = harness('<button id="save" title="Save request"> Save <strong>changes</strong></button><span>Settings</span><span>Language</span>');
  try {
    assert.equal(h.getLanguage(), 'en');
    h.setLanguage('zh-CN');
    assert.equal(h.$('#save').firstChild.data, ' 保存 ');
    assert.equal(h.$('#save').title, '保存请求');
    assert.ok(h.$('#save strong'));
    assert.equal(h.w.document.documentElement.lang, 'zh-CN');
    assert.equal(h.$('span').textContent, '设置');
    h.setLanguage('en');
    assert.equal(h.$('#save').firstChild.data, ' Save ');
    assert.equal(h.$('#save').title, 'Save request');
    assert.equal(h.$('span').textContent, 'Settings');
    h.setLanguage('zh-CN');
    assert.equal(h.$('span').textContent, '设置');
  } finally { h.close(); }
});

test('UI localization preserves names, payloads, responses and all editable values even when they equal UI keys', () => {
  const h = harness(`<span id="name" data-no-translate>Save</span><div translate="no"><span>Settings</span></div>
    <input id="url" value="Settings" placeholder="Enter URL or paste text"/><textarea aria-label="Request body" placeholder="Add a description for this request">Save</textarea>
    <pre>Save</pre><code>Settings</code><div contenteditable="true">Save</div>
    <span class="input-highlight">Save</span><div class="response-headers"><span>Save</span></div>
    <button class="request-tab" data-select-tab="r" title="Save"><span data-no-translate>Save</span></button>
    <select><option value="e1" data-no-translate>Save</option></select>`);
  try {
    h.setLanguage('zh-CN');
    assert.equal(h.$('#name').textContent, 'Save');
    assert.equal(h.$('[translate=no]').textContent, 'Settings');
    assert.equal(h.$('#url').value, 'Settings');
    assert.equal(h.$('#url').getAttribute('value'), 'Settings');
    assert.equal(h.$('#url').placeholder, '输入 URL 或粘贴文本');
    for (const selector of ['textarea', 'pre', '[contenteditable]', '.input-highlight', '.response-headers', 'option']) assert.equal(h.$(selector).textContent, 'Save', selector);
    assert.equal(h.$('code').textContent, 'Settings');
    assert.equal(h.$('textarea').getAttribute('aria-label'), '请求体');
    assert.equal(h.$('textarea').placeholder, '为此请求添加描述');
    assert.equal(h.$('.request-tab').title, 'Save', 'Request title is user data');
  } finally { h.close(); }
});

test('translating option labels preserves enum values and selected option used by request logic', () => {
  const h = harness('<select id="auth"><option>No Auth</option><option selected>Basic Auth</option></select><select id="indent"><option value="spaces">Spaces</option></select>');
  try {
    h.setLanguage('zh-CN');
    assert.equal(h.$('#auth').value, 'Basic Auth');
    const noAuth = h.$('#auth option');
    assert.equal(noAuth.textContent, '无授权');
    assert.equal(noAuth.value, 'No Auth');
    assert.equal(h.$('#indent').value, 'spaces');
    assert.equal(h.$('#indent option').textContent, '空格');
    h.setLanguage('en');
    assert.equal(noAuth.textContent, 'No Auth');
    assert.equal(h.$('#auth').value, 'Basic Auth');
  } finally { h.close(); }
});

test('dynamic status updates translate immediately and roundtrip to their latest English source', async () => {
  const h = harness('<button id="send">Send</button><div id="notices"></div>');
  try {
    const disconnect = h.observeUi(h.w.document.body);
    h.setLanguage('zh-CN');
    h.$('#send').textContent = 'Sending…';
    const notice = h.w.document.createElement('div');
    notice.textContent = 'All changes saved';
    h.$('#notices').append(notice);
    await settle();
    assert.equal(h.$('#send').textContent, '正在发送…');
    assert.equal(notice.textContent, '所有更改已保存');
    h.setLanguage('en');
    assert.equal(h.$('#send').textContent, 'Sending…');
    assert.equal(notice.textContent, 'All changes saved');
    disconnect();
    h.setLanguage('zh-CN');
    notice.textContent = 'Save';
    await settle();
    assert.equal(notice.textContent, 'Save');
  } finally { h.close(); }
});

test('interpolations and known message prefixes preserve user text verbatim', () => {
  const h = harness();
  try {
    h.setLanguage('zh-CN');
    assert.equal(h.t('Could not save settings: disk full at /Users/a/Settings'), '无法保存设置：disk full at /Users/a/Settings');
    assert.equal(h.t('Close Save'), '关闭：Save');
    assert.equal(h.t('Variable 3'), '变量 3');
    assert.equal(h.t('Settings (⌘,)'), '设置 (⌘,)');
    assert.equal(h.t('Unknown {name}', { name: 'Save' }), 'Unknown Save');
    assert.equal(h.t('Custom response string'), 'Custom response string');
    assert.equal(h.setLanguage('unsupported'), 'en');
    assert.equal(h.t('Save'), 'Save');
  } finally { h.close(); }
});

test('repeated DOM translation is idempotent and does not replace controls or attached handlers', () => {
  const h = harness('<button id="save" aria-label="Save request">Save</button><input value="payload"/>');
  try {
    let clicks = 0;
    const button = h.$('#save');
    button.addEventListener('click', () => clicks++);
    h.setLanguage('zh-CN');
    for (let i = 0; i < 20; i++) h.translateUi(h.w.document);
    button.click();
    assert.equal(h.$('#save'), button);
    assert.equal(button.textContent, '保存');
    assert.equal(button.getAttribute('aria-label'), '保存请求');
    assert.equal(clicks, 1);
    h.setLanguage('en');
    assert.equal(button.textContent, 'Save');
    assert.equal(button.getAttribute('aria-label'), 'Save request');
  } finally { h.close(); }
});


test('dynamic localization only visits changed branches and skips protected request content', async () => {
  const h = harness('<aside id="collections"><span data-no-translate>Settings</span></aside><button id="send">Send</button><section id="new"></section><div data-no-translate id="payload">History</div>');
  try {
    const disconnect = h.observeUi(h.w.document.body);
    h.setLanguage('zh-CN'); await settle();
    const doc = h.w.document, walks = [], createTreeWalker = doc.createTreeWalker.bind(doc);
    doc.createTreeWalker = (...args) => { walks.push(args[0]); return createTreeWalker(...args); };
    h.$('#send').firstChild.data = 'Sending…';
    h.$('#send').title = 'Send request';
    h.$('#payload').textContent = 'Settings';
    const branch = doc.createElement('div');
    branch.innerHTML = '<button>Save</button><span data-no-translate>Settings</span>';
    h.$('#new').append(branch);
    await settle();
    assert.equal(h.$('#send').textContent, '正在发送…');
    assert.equal(h.$('#send').title, '发送请求');
    assert.equal(branch.querySelector('button').textContent, '保存');
    assert.equal(branch.querySelector('span').textContent, 'Settings');
    assert.equal(h.$('#payload').textContent, 'Settings');
    assert.equal(walks.includes(doc.body), false, 'Status and editor updates must not walk the whole UI');
    assert.equal(walks.includes(h.$('#collections')), false);
    assert.ok(walks.includes(branch), 'New controls are localized');
    disconnect();
  } finally { h.close(); }
});
