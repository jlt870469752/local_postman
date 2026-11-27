import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCollection } from '../src/import-collection.js';

const row = (key, value, active = true) => ({ key, value, active, description: 'keep description' });
const request = (extra = {}) => ({ name: 'Request', endpoint: 'https://example.test', method: 'POST', auth: { authType: 'inherit', authActive: true }, headers: [], params: [], requestVariables: [], body: { contentType: null, body: null }, ...extra });
const folder = (extra = {}) => ({ v: 12, name: 'APIs', folders: [], requests: [], variables: [], headers: [], auth: { authType: 'inherit', authActive: true }, ...extra });

test('Hoppscotch folders, row state, inherited auth/headers and variable scopes are retained without mutating input', () => {
  const source = folder({ variables: [row('base', 'https://example.test')], headers: [row('X-Shared', 'root'), row('X-Root', 'keep')], auth: { authType: 'bearer', token: '<<token>>' }, folders: [folder({ name: 'Outer', headers: [row('x-shared', 'folder')], variables: [row('token', 'folder-token')], folders: [folder({ name: 'Inner', requests: [request({ endpoint: '<<base>>/users?existing=1&existing=2', params: [row('tag', 'one'), row('tag', 'two', false)], headers: [row('x-shared', 'disabled', false), row('X-Tag', 'one'), row('X-Tag', 'two')], requestVariables: [row('token', 'request-token')], preRequestScript: 'doNotExecute()', testScript: 'alsoDoNotExecute()' })] })] })] });
  const original = structuredClone(source), { collection, warnings } = parseCollection(source);
  assert.deepEqual(source, original);
  assert.equal(collection.folders.length, 2);
  assert.equal(collection.folders[1].parentId, collection.folders[0].id);
  const imported = collection.items[0];
  assert.equal(imported.folderId, collection.folders[1].id);
  assert.equal(imported.url, '{{base}}/users?existing=1&existing=2');
  assert.deepEqual(imported.params.map(r => [r.key, r.value, r.enabled]), [['existing', '1', true], ['existing', '2', true], ['tag', 'one', true], ['tag', 'two', false]]);
  assert.deepEqual(imported.headers.map(r => [r.key, r.value, r.enabled]), [['X-Root', 'keep', true], ['x-shared', 'disabled', false], ['X-Tag', 'one', true], ['X-Tag', 'two', true]]);
  assert.deepEqual(imported.auth, { type: 'Bearer Token', token: '{{token}}', location: 'header' });
  assert.equal(imported.variables[0].value, 'request-token');
  assert.equal(collection.variables[0].value, 'https://example.test');
  assert.equal(collection.folders[0].variables[0].value, 'folder-token');
  assert.equal(imported.preRequestScript, 'doNotExecute()');
  assert.equal(imported.tests, 'alsoDoNotExecute()');
  assert.ok(warnings.some(warning => /not executed/.test(warning)));
});

test('Hoppscotch preserves mixed urlencoded text byte for byte and retains declared MIME types', () => {
  for (const body of ['a=one+two&a=%2F', 'a:one\nb:two', '{"a":"one","b":2}']) {
    const { collection } = parseCollection(folder({ requests: [request({ body: { contentType: 'application/x-www-form-urlencoded', body } })] }));
    const imported = collection.items[0];
    assert.equal(imported.body, body);
    assert.equal(imported.bodyType, 'raw');
    assert.equal(imported.rawFormat, 'Text');
    assert.deepEqual(imported.headers.map(r => [r.key, r.value]), [['Content-Type', 'application/x-www-form-urlencoded']]);
  }
  const { collection } = parseCollection(folder({ requests: [request({ body: { contentType: 'application/problem+json; charset=utf-8', body: '{"id":"<<id>>"}' } })] }));
  assert.equal(collection.items[0].rawFormat, 'JSON');
  assert.equal(collection.items[0].body, '{"id":"{{id}}"}');
  assert.equal(collection.items[0].headers[0].value, 'application/problem+json; charset=utf-8');
});

test('Hoppscotch multipart text, duplicate fields, disabled state and file references are preserved', () => {
  const { collection, warnings } = parseCollection(folder({ requests: [request({ body: { contentType: 'multipart/form-data', body: [{ ...row('tag', 'one'), isFile: false }, { ...row('tag', 'two', false), isFile: false }, { ...row('file', '/do/not/read'), isFile: true }] } })] }));
  const imported = collection.items[0];
  assert.equal(imported.bodyType, 'form-data');
  assert.deepEqual(imported.bodyFields.map(r => [r.key, r.value, r.enabled]), [['tag', 'one', true], ['tag', 'two', false], ['file', '/do/not/read', false]]);
  assert.equal(imported.bodyFields[2].src, '/do/not/read');
  assert.ok(warnings.some(warning => /local files were not read/.test(warning)));
});

test('Hoppscotch explicit and inactive auth override inheritance', () => {
  const { collection } = parseCollection(folder({ auth: { authType: 'bearer', token: 'root' }, requests: [
    request({ auth: { authType: 'none' } }), request({ auth: { authType: 'inherit', authActive: false } }),
    request({ auth: { authType: 'basic', username: 'user', password: '<<password>>' } }),
    request({ auth: { authType: 'api-key', key: 'key', value: 'value', addTo: 'Query params' } }),
  ] }));
  assert.equal(collection.items[0].auth.type, 'No Auth');
  assert.equal(collection.items[1].auth.type, 'No Auth');
  assert.equal(collection.items[2].auth.password, '{{password}}');
  assert.equal(collection.items[3].auth.location, 'query');
});

test('Hoppscotch malformed records fail and repeated imports allocate independent IDs', () => {
  for (const invalid of [folder({ requests: [null] }), folder({ folders: [{}] }), folder({ requests: [request({ params: {} })] }), folder({ requests: [request({ body: { contentType: 'application/json', body: {} } })] })]) {
    assert.throws(() => parseCollection(invalid), /Hoppscotch/);
  }
  const source = folder({ folders: [folder({ requests: [request()] })] });
  let sequence = 0;
  const id = prefix => prefix + ++sequence;
  const first = parseCollection(source, id).collection, second = parseCollection(source, id).collection;
  const firstIds = new Set([first.id, ...first.folders.map(f => f.id), ...first.items.map(r => r.id)]);
  assert.ok([second.id, ...second.folders.map(f => f.id), ...second.items.map(r => r.id)].every(value => !firstIds.has(value)));
  assert.equal(parseCollection(folder()).collection.items.length, 0);
  assert.equal(parseCollection({ info: { name: 'Postman still works' }, item: [] }).collection.name, 'Postman still works');
});
