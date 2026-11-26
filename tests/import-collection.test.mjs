import assert from 'node:assert/strict';
import { parsePostmanCollection } from '../src/import-collection.js';
const ids = (() => { let i = 0; return p => `${p}${++i}`; })();
const source = { info: { name: 'Parity APIs', description: { content: 'local' }, schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' }, variable: [{ key: 'host', value: 'api.test' }], auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{token}}' }] }, item: [{ name: 'Users', item: [{ name: 'List', request: { method: 'GET', url: { raw: 'https://{{host}}/users?x=1', query: [{ key: 'x', value: '1' }, { key: 'x', value: '2', disabled: true }] }, header: [{ key: 'Accept', value: 'application/json' }], description: 'list' }, response: [{ name: 'ok', status: 'OK', body: '{"ok":true}' }] }, { name: 'Create', request: { method: 'POST', url: 'https://api.test/users', body: { mode: 'raw', raw: '{"name":"x"}', options: { raw: { language: 'json' } } }, auth: { type: 'basic', basic: [{ key: 'username', value: 'u' }, { key: 'password', value: 'p' }] } } }] }] };
const { collection, warnings } = parsePostmanCollection(source, ids);
assert.equal(collection.name, 'Parity APIs'); assert.equal(collection.variables[0].key, 'host'); assert.equal(collection.folders.length, 1); assert.equal(collection.items.length, 2);
assert.equal(collection.items[0].folderId, collection.folders[0].id); assert.deepEqual(collection.items[0].params.map(x => [x.key, x.enabled]), [['x', true], ['x', false]]); assert.equal(collection.items[0].auth.type, 'Bearer Token');
assert.equal(collection.items[1].bodyType, 'raw'); assert.equal(collection.items[1].rawFormat, 'JSON'); assert.equal(collection.items[1].auth.type, 'Basic Auth'); assert.equal(collection.items[0].examples[0].body, '{"ok":true}'); assert.deepEqual(warnings, []);
assert.throws(() => parsePostmanCollection({ info: {}, item: [] }), /Expected a Postman Collection/);
const complex = { info: { name: 'Nested v2 collection' }, auth: { type: 'bearer', bearer: [{ key: 'token', value: 'collection-token' }] }, item: [
  { id: 'duplicate', name: 'Outer', auth: { type: 'basic', basic: [{ key: 'username', value: 'u' }, { key: 'password', value: 'p' }] }, item: [
    { id: 'duplicate', name: 'Inner', auth: null, item: [
      { id: 'duplicate', name: 'GraphQL', request: { method: 'POST', auth: null, url: { protocol: 'http', host: ['127', '0', '0', '1'], port: '8080', path: ['api', 'graphql'], query: [{ key: 'tag', value: 'one' }, { key: 'tag', value: 'two', disabled: true, description: 'keep disabled' }] }, header: 'Accept: application/json\r\nX-Tag: one\r\nX-Tag: two', body: { mode: 'graphql', graphql: { query: 'query { id }', variables: { id: 2 } } } }, event: [{ listen: 'test', script: { exec: ['pm.test("ok", () => {});'] } }] },
      { name: 'No auth', request: { auth: { type: 'noauth' }, url: 'https://example.test?a=1&a=2', body: { mode: 'urlencoded', urlencoded: [{ key: 'a', value: '1' }] } } },
      { name: 'Upload', request: { url: 'https://example.test', body: { mode: 'formdata', formdata: [{ key: 'text', value: 'hello' }, { key: 'file', type: 'file', src: '/never/read' }] } } },
    ] },
  ] },
] };
const before = JSON.stringify(complex), parsed = parsePostmanCollection({ collection: complex }, ids), second = parsePostmanCollection(complex, ids);
assert.equal(JSON.stringify(complex), before, 'Import never mutates the supplied document');
const graph = parsed.collection.items[0];
assert.equal(graph.url, 'http://127.0.0.1:8080/api/graphql?tag=one');
assert.equal(graph.auth.type, 'Basic Auth'); assert.equal(graph.headers.length, 3);
assert.equal(graph.params[1].enabled, false); assert.equal(graph.params[1].description, 'keep disabled');
assert.equal(graph.bodyType, 'graphql'); assert.equal(JSON.parse(graph.graphqlVariables).id, 2);
assert.match(graph.tests, /pm.test/); assert.ok(parsed.warnings.some(w => /not executed/.test(w)));
assert.equal(parsed.collection.items[1].auth.type, 'No Auth'); assert.equal(parsed.collection.items[1].params.length, 2);
assert.equal(parsed.collection.items[2].bodyFields[1].enabled, false); assert.equal(parsed.collection.items[2].bodyFields[1].src, '/never/read');
assert.equal(graph.folderId, parsed.collection.folders[1].id); assert.equal(parsed.collection.folders[1].parentId, parsed.collection.folders[0].id);
const firstIds = new Set([parsed.collection.id, ...parsed.collection.folders.map(f => f.id), ...parsed.collection.items.map(r => r.id)]);
assert.ok([second.collection.id, ...second.collection.folders.map(f => f.id), ...second.collection.items.map(r => r.id)].every(id => !firstIds.has(id)));
assert.equal(parsePostmanCollection({ info: { name: 'Empty' }, item: [] }).collection.items.length, 0);
for (const invalid of [null, [], { info: { name: 'Bad' }, item: [null] }, { info: { name: 'Bad' }, item: {} }]) assert.throws(() => parsePostmanCollection(invalid));
console.log('PASS: Postman Collection v2.1 folders, URLs, duplicate query params, headers, bodies, auth, variables and examples');
