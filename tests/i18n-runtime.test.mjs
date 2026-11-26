import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserInvoke } from '../src/runtime.js';

function harness(entries = new Map()) {
  const storage = { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) };
  return { entries, storage, invoke: createBrowserInvoke({ storage }) };
}

test('Language preference defaults to English and survives a fresh browser runtime in both directions', async () => {
  const h = harness();
  const initial = await h.invoke('settings_load'); assert.equal(initial.general.language, 'en');
  initial.general.language = 'zh-CN';
  const saved = await h.invoke('settings_save', { settings: initial }); assert.equal(saved.general.language, 'zh-CN');
  const restarted = createBrowserInvoke({ storage: h.storage });
  const restored = await restarted('settings_load'); assert.equal(restored.general.language, 'zh-CN');
  restored.general.language = 'en'; await restarted('settings_save', { settings: restored });
  assert.equal((await createBrowserInvoke({ storage: h.storage })('settings_load')).general.language, 'en');
  assert.equal(JSON.parse(h.entries.get('localpostman-preferences-backup')).general.language, 'zh-CN');
});

test('Legacy preferences without language and unsupported language codes fall back to English', async () => {
  const h = harness(new Map([['localpostman-preferences', JSON.stringify({ general: { timeout: 1250 } })]]));
  const legacy = await h.invoke('settings_load'); assert.equal(legacy.general.language, 'en'); assert.equal(legacy.general.timeout, 1250);
  legacy.general.language = 'fr';
  assert.equal((await h.invoke('settings_save', { settings: legacy })).general.language, 'en');
  assert.equal((await h.invoke('settings_load')).general.language, 'en');
});

test('Malformed stored preferences prevent a language change from silently replacing the original file', async () => {
  for (const corrupt of ['{broken', 'null', '[]']) {
    const h = harness(new Map([['localpostman-preferences', corrupt]]));
    await assert.rejects(h.invoke('settings_load'), /SETTINGS_INVALID/);
    await assert.rejects(h.invoke('settings_save', { settings: { general: { language: 'zh-CN' } } }), /SETTINGS_INVALID/);
    assert.equal(h.entries.get('localpostman-preferences'), corrupt);
  }
});

test('A browser storage error keeps the previous saved language available for a later launch', async () => {
  const h = harness();
  const initial = await h.invoke('settings_load'); await h.invoke('settings_save', { settings: initial });
  const invoke = createBrowserInvoke({ storage: { getItem: h.storage.getItem, setItem: () => { throw Error('disk full'); } } });
  await assert.rejects(invoke('settings_save', { settings: { general: { language: 'zh-CN' } } }), /disk full/);
  assert.equal((await h.invoke('settings_load')).general.language, 'en');
});
