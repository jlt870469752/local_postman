import assert from 'node:assert/strict';
import { createBrowserInvoke, createRuntimeInvoke } from '../src/runtime.js';

const entries = new Map(), downloads = [];
const storage = { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) };
const browser = createBrowserInvoke({ storage, download: (...args) => downloads.push(args) });
await assert.rejects(browser('load_workspace'), /尚无浏览器本地工作区/);
const workspace = { collections: [{ id: 'c', name: 'Local', folders: [], items: [] }], environments: [], mockServers: [] };
await browser('save_workspace', { workspace });
workspace.collections[0].name = 'Unsaved';
const restored = await createBrowserInvoke({ storage })('load_workspace');
assert.equal(restored.collections[0].name, 'Local', 'Saved data survives a fresh runtime and is independent of later edits');
restored.collections[0].name = 'Read copy';
assert.equal((await browser('load_workspace')).collections[0].name, 'Local');
for (const command of ['send_request', 'git_status', 'git_sync', 'mock_start', 'mock_stop'])
  await assert.rejects(browser(command), /需要在桌面客户端中使用/);
assert.deepEqual(await browser('mock_status'), []);
await browser('export_workspace', { workspace });
assert.equal(downloads[0][0], 'localpostman-export.json');
assert.deepEqual(JSON.parse(downloads[0][1]), workspace);
await browser('export_response', { body: '{"ok":true}' });
assert.equal(downloads[1][1], '{"ok":true}');
await assert.rejects(createBrowserInvoke({ storage: { setItem() { throw Error('Quota exceeded'); } } })('save_workspace', { workspace }), /浏览器本地保存不可用.*Quota/);
let native = false;
const calls = [];
const invoke = createRuntimeInvoke({ isNative: () => native, native: (...args) => { calls.push(args); return 'native'; }, browser });
assert.equal((await invoke('load_workspace')).collections[0].name, 'Local');
native = true;
assert.equal(await invoke('save_workspace', { workspace }), 'native');
assert.deepEqual(calls, [['save_workspace', { workspace }]]);
console.log('PASS: browser local persistence, export, desktop-only actions, storage errors and native routing');

const pending = [], nativeWrites = [];
const queued = createRuntimeInvoke({ isNative: () => true, browser, native: (command, args) => {
  nativeWrites.push(args.workspace.name);
  return new Promise((resolve, reject) => pending.push({ resolve, reject }));
}});
const mutable = { workspace: { name: 'first' } };
const firstWrite = queued('save_workspace', mutable);
mutable.workspace.name = 'mutated';
const secondWrite = queued('save_workspace', { workspace: { name: 'second' } });
await Promise.resolve();
assert.deepEqual(nativeWrites, ['first'], 'Snapshot captured on enqueue; later writes wait');
const failed = assert.rejects(firstWrite, /disk failure/);
pending.shift().reject(Error('disk failure'));
await failed; await Promise.resolve(); await Promise.resolve();
assert.deepEqual(nativeWrites, ['first', 'second'], 'A rejected write does not block newer edits');
pending.shift().resolve('saved');
assert.equal(await secondWrite, 'saved');
console.log('PASS: native writes preserve call order, snapshots and failure recovery');

const order = [], blockers = [];
const syncInvoke = createRuntimeInvoke({ isNative: () => true, browser, native: (command) => {
  order.push(command);
  return command === 'save_workspace' ? new Promise(resolve => blockers.push(resolve)) : 'synced';
}});
const outstanding = syncInvoke('save_workspace', { workspace: {} });
const sync = syncInvoke('git_sync', { push: false });
await Promise.resolve();
assert.deepEqual(order, ['save_workspace']);
blockers.shift()(); await outstanding;
assert.equal(await sync, 'synced');
assert.deepEqual(order, ['save_workspace', 'git_sync'], 'Git reads the latest persisted editor metadata');
console.log('PASS: Git sync waits for preceding workspace writes');

const before = entries.get('localpostman-workspace');
await browser('save_workspace', { workspace: restored });
assert.equal((await browser('workspace_recovery_info')).backupAvailable, true);
entries.set('localpostman-workspace', '{broken');
await assert.rejects(browser('save_workspace', { workspace }), /已阻止覆盖/);
assert.equal(entries.get('localpostman-workspace'), '{broken', 'Corrupt workspace is preserved until explicit recovery');
assert.deepEqual(await browser('restore_workspace_backup'), JSON.parse(before));
assert.deepEqual(await browser('load_workspace'), JSON.parse(before));
entries.set('localpostman-workspace', JSON.stringify({ collections: {} }));
await assert.rejects(browser('load_workspace'), /格式错误/);
await assert.rejects(browser('save_workspace', { workspace }), /已阻止覆盖/);
console.log('PASS: browser backup recovery and invalid workspace overwrite protection');

const guardedCalls = [];
let failWrites = true;
const guarded = createRuntimeInvoke({ isNative: () => true, browser, native: async command => {
  guardedCalls.push(command);
  if (command === 'save_workspace' && failWrites) throw Error('read-only disk');
  return command;
}});
await assert.rejects(guarded('save_workspace', { workspace: {} }), /read-only disk/);
for (const command of ['git_preview', 'git_sync', 'git_pull']) await assert.rejects(guarded(command, {}), /Latest workspace save failed/);
assert.deepEqual(guardedCalls, ['save_workspace'], 'No Git mutation or disk preview after a failed latest save');
assert.equal(await guarded('git_open', { path: '/read-only' }), 'git_open', 'Read-only inspection remains available');
failWrites = false;
await guarded('save_workspace', { workspace: {} });
assert.equal(await guarded('git_sync', {}), 'git_sync', 'Successful retry clears the failure barrier');
console.log('PASS: failed latest save blocks Git until a successful retry');
