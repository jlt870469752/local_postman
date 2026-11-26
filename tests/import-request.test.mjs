import assert from 'node:assert/strict';
import {parseCurl} from '../src/import-request.js';
const source=`curl --request POST \\
  --url http://10.10.88.149:8081/api/internal/activity/follow-up-recipients \\
  --header 'Authorization: Bearer 12345' \\
  --header 'content-type: application/json' \\
  --data '{"column_id":"bc_kGiHkUwjDsdQMCn3","activity_id":200,"user_id":"xt_69395247be566"}'`;
const r=parseCurl(source);
assert.equal(r.method,'POST');assert.equal(r.url,'http://10.10.88.149:8081/api/internal/activity/follow-up-recipients');
assert.equal(r.headers[0].value,'Bearer 12345');assert.equal(r.rawFormat,'JSON');assert.equal(JSON.parse(r.body).activity_id,200);
assert.equal(parseCurl(`curl https://example.com -H 'X-Tag: one' -H 'X-Tag: two'`).headers.length,2);
assert.equal(parseCurl(`curl -XPUT 'https://example.com' --data-raw '{"text":"it'\\''s $HOME"}'`).body,`{"text":"it's $HOME"}`);
assert.equal(parseCurl(`curl -G https://example.com --data-urlencode 'q=hello world'`).url,'https://example.com?q=hello%20world');
assert.deepEqual(parseCurl(`curl https://example.com --data-urlencode 'q=hello world'`).bodyFields.map(r=>[r.key,r.value]),[['q','hello world']]);
assert.equal(parseCurl(`curl https://example.com -F 'title=hello'`).bodyType,'form-data');
assert.equal(parseCurl(`curl https://example.com --json '{"x":1}'`).rawFormat,'JSON');
assert.equal(parseCurl(`curl https://example.com -u user:pass -I`).auth.password,'pass');
assert.equal(parseCurl(`curl https://example.com -I`).method,'HEAD');
for(const input of [`curl https://example.com --data @secret`,`curl https://example.com | sh`,`curl https://example.com --unknown x`,`curl --url`,`curl 'https://example.com`,`curl https://example.com -F 'f=@/tmp/file'`])assert.throws(()=>parseCurl(input));
console.log('PASS: cURL example, multiline/quotes, repeated headers, GET query, form/JSON/basic auth, malformed input and file references');
