const fs=require('node:fs'),assert=require('node:assert/strict');
const {JSDOM,VirtualConsole}=require('jsdom');
const tick=()=>new Promise(r=>setImmediate(r));
const fixture=()=>({collections:[{id:'c',name:'User APIs',folders:[],items:[
 {id:'r-get',name:'Get users',method:'GET',url:'https://example.test/users',headers:[],params:[],body:'',examples:[{code:202,body:'[{"id":1}]',headers:[{key:'Content-Type',value:'application/json',enabled:true},{key:'X-Example',value:'users',enabled:true}]}]},
 {id:'r-post',name:'Create user',method:'POST',url:'{{baseUrl}}/users?ignored=1',headers:[],params:[],body:'{}',examples:[{code:201,body:'{"created":true}',headers:[]}]},
 {id:'r-delete',name:'Delete user',method:'DELETE',url:'https://example.test/users/1',headers:[],params:[],body:''},
]},{id:'c-extra',name:'Health APIs',folders:[],items:[{id:'r-health',name:'Health',method:'GET',url:'http://localhost/health',headers:[],params:[],body:''}]}],environments:[],history:[],mockServers:[]});
async function harness(workspace=fixture(),options={}){
 const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
 const dom=new JSDOM('<div id="app"></div>',{url:'http://localhost/',runScripts:'outside-only',virtualConsole:vc}),w=dom.window;w.TextEncoder=TextEncoder;
 let saved,started,failSave=false,holdCommand=null,release=null;const runtime=new Map((options.running||[]).map(server=>[server.id,server]));
 w.testInvoke=async(command,args)=>{if(command==='load_workspace')return structuredClone(workspace);if(command==='save_workspace'){if(failSave)throw Error('disk failure');saved=structuredClone(args.workspace);return}if(command==='git_status')return 'main';if(command==='service_status')return [];if(command==='mock_status'){if(holdCommand==='mock_status')await new Promise(resolve=>release=resolve);return [...runtime.values()]}if(command==='mock_start'){started=structuredClone(args.config);if(holdCommand==='mock_start')await new Promise(resolve=>release=resolve);const server={id:args.config.id,port:51234,logs:[]};runtime.set(server.id,server);return server}if(command==='mock_stop'){if(holdCommand==='mock_stop')await new Promise(resolve=>release=resolve);runtime.delete(args.id);return;}throw Error('Unexpected invoke '+command)};
 const modules=['src/assets/postman-icons.js','src/import-request.js','src/import-collection.js','src/code-snippets.js'].map(p=>fs.readFileSync(p,'utf8').replace(/^export /gm,'')).join('\n');
 w.eval('const invoke=window.testInvoke;\n'+modules+'\n'+fs.readFileSync('src/app.js','utf8').replace(/^import .*;\s*$/gm,''));await tick();
 const $=s=>w.document.querySelector(s),all=s=>[...w.document.querySelectorAll(s)],click=s=>{const el=typeof s==='string'?$(s):s;assert.ok(el,'Missing '+s);el.click()},fill=(s,v)=>{assert.ok($(s),'Missing '+s);$(s).value=v;$(s).dispatchEvent(new w.Event('input',{bubbles:true}))},select=(s,v)=>{fill(s,v);$(s).dispatchEvent(new w.Event('change',{bubbles:true}))};
 return{w,dom,$,all,click,fill,select,snapshot:()=>structuredClone(saved),started:()=>structuredClone(started),failSave:v=>{failSave=v},hold:command=>{holdCommand=command},release:()=>{holdCommand=null;release?.();release=null},done:async()=>{await tick();assert.deepEqual(errors,[]);w.close()}};
}
(async()=>{
 const h=await harness();let persisted,mockId;
 try{
  h.click('[data-view="services"]');h.click('#createMockEmpty');assert.equal(h.$('[name="mockDeployType"][value="collection"]').checked,true,'Empty mock list defaults to Collection');
  h.fill('#deployMockName','User mock');h.select('#deployMockSelect','c');h.click('#confirmMockDeploy');await tick();
  assert.equal(h.all('[data-mock-route]').length,3,'Every collection request is available, including the same path with different methods');
  let mock=h.snapshot().mockServers[0];mockId=mock.id;assert.equal(mock.collectionId,'c');assert.deepEqual(mock.routes.map(r=>[r.sourceRequestId,r.method,r.path,r.status]),[['r-get','GET','/users',202],['r-post','POST','/users',201],['r-delete','DELETE','/users/1',200]]);
  assert.equal(h.$('#mockBody').value,'[{"id":1}]');assert.equal(JSON.parse(h.$('#mockHeaders').value)['X-Example'],'users');
  h.fill('#mockBody','[{"id":2}]');h.fill('#mockHeaders','{"Content-Type":"application/json","X-Route":"get"}');h.fill('#mockDelay','25');h.click('[data-mock-route="1"]');
  assert.equal(h.$('#mockBody').value,'{"created":true}','Selecting another route loads its own response');h.fill('#mockBody','{"created":"edited"}');h.fill('#mockStatus','203');h.click('[data-mock-route="0"]');assert.equal(h.$('#mockBody').value,'[{"id":2}]','Switching retains prior route edits');assert.equal(h.$('#mockDelay').value,'25');
  h.click('#mockImportCollection');assert.equal(h.all('[data-mock-route]').length,3,'Importing the same collection does not duplicate or overwrite edited routes');assert.equal(h.$('#mockBody').value,'[{"id":2}]');
  h.click('#addMockRoute');assert.equal(h.all('[data-mock-route]').length,4);h.fill('#mockPath','/custom');h.fill('#mockBody','custom body');h.select('#mockMethod','HEAD');h.click('#saveMockRoute');await tick();mock=h.snapshot().mockServers[0];assert.equal(mock.routes[3].method,'HEAD');assert.equal(mock.routes[3].path,'/custom');assert.equal(mock.routes[1].body,'{"created":"edited"}');
  h.select('#mockCollection','c-extra');assert.equal(h.all('[data-mock-route]').length,5,'Associating another collection adds missing requests and preserves configured responses');assert.equal(h.snapshot().mockServers[0].collectionId,'c-extra');
  h.click('#deleteMockRoute');assert.equal(h.all('[data-mock-route]').length,4,'Deleting selected custom route retains other routes');
  h.click('[data-mock-route="0"]');h.fill('#mockHeaders','{broken');h.click('[data-mock-route="1"]');assert.equal(h.$('[data-mock-route="0"]').getAttribute('aria-current'),'true','Invalid response blocks selection without losing typed content');assert.match(h.$('#mockError').textContent,/JSON object/);h.fill('#mockHeaders','{"Content-Type":"application/json","X-Route":"get"}');
  h.click('#saveMockRoute');await tick();persisted=h.snapshot();h.click('#toggleMock');await tick();assert.equal(h.started().routes.length,4,'Start receives the complete route list');assert.equal(h.started().routes[0].body,'[{"id":2}]');assert.equal(h.$('#mockCollection').closest('fieldset').disabled,true,'Running service routes are read-only until stopped');assert.match(h.$('.mock-runtime-url').textContent,/51234/);h.click('#toggleMock');await tick();assert.equal(h.$('#mockCollection').closest('fieldset').disabled,false);
 }finally{await h.done()}
 const reloaded=await harness(persisted);
 try{reloaded.click('[data-view="services"]');reloaded.click(`[data-mock-select="${mockId}"]`);assert.equal(reloaded.all('[data-mock-route]').length,4);assert.equal(reloaded.$('#mockBody').value,'[{"id":2}]');reloaded.click('[data-mock-route="1"]');assert.equal(reloaded.$('#mockBody').value,'{"created":"edited"}');assert.equal(reloaded.$('#mockStatus').value,'203')}finally{await reloaded.done()}
 const data=fixture();
 data.collections[0].items[1].examples[0].body='';
 data.collections[0].items.push({...structuredClone(data.collections[0].items[0]),id:'duplicate',method:'get',name:'Duplicate URL'});
 const edge=await harness(data);let emptySnapshot;
 try{
  edge.click('[data-view="services"]');edge.click('#createMockEmpty');
  assert.equal(edge.$('#deployPublic'),null,'Unsupported cloud/public controls are hidden');
  assert.equal(edge.$('#deployMockSlug'),null,'No fake cloud URL is shown');
  edge.select('#deployMockSelect','c');edge.click('#confirmMockDeploy');await tick();
  assert.equal(edge.all('[data-mock-route]').length,3,'Duplicate method/path is imported once');
  edge.click('[data-mock-route="1"]');assert.equal(edge.$('#mockBody').value,'','Empty example response remains empty');
  edge.fill('#mockHeaders','invalid');edge.click('#deleteMockRoute');
  assert.equal(edge.all('[data-mock-route]').length,2,'Deleting an invalid selected route is possible');
  edge.click('#deleteMockRoute');edge.click('#deleteMockRoute');
  assert.equal(edge.all('[data-mock-route]').length,0);assert.equal(edge.$('#mockPath'),null,'Last deletion leaves an empty editor');
  assert.equal(edge.$('#toggleMock').disabled,true);edge.click('#saveMockRoute');await tick();emptySnapshot=edge.snapshot();
  edge.click('#mockImportCollection');edge.click('[data-mock-route="1"]');
  const firstId=edge.snapshot().mockServers[0].id;
  edge.click('#createMock');edge.select('#deployMockSelect',firstId);edge.click('#confirmMockDeploy');await tick();
  const secondId=edge.snapshot().mockServers[1].id;
  assert.equal(edge.$('[data-mock-route="0"]').getAttribute('aria-current'),'true');
  edge.click(`[data-mock-select="${firstId}"]`);assert.equal(edge.$('[data-mock-route="1"]').getAttribute('aria-current'),'true','Each server remembers its own selected route');
  edge.click(`[data-mock-select="${secondId}"]`);assert.equal(edge.$('[data-mock-route="0"]').getAttribute('aria-current'),'true');
 }finally{await edge.done()}
 const empty=await harness(emptySnapshot);
 try{empty.click('[data-view="services"]');empty.click(`[data-mock-select="${emptySnapshot.mockServers[0].id}"]`);assert.equal(empty.all('[data-mock-route]').length,0,'Reload does not recreate a deleted route')}finally{await empty.done()}
 const concurrent=await harness(persisted,{running:[{id:mockId,port:51234,logs:[]}]});
 try{
  concurrent.click('[data-view="services"]');concurrent.click(`[data-mock-select="${mockId}"]`);
  assert.equal(concurrent.$('#toggleMock').textContent,'Stop','Reload restores the native running state');
  concurrent.$('#mockHeaders').value='invalid';concurrent.click('#toggleMock');await tick();
  assert.equal(concurrent.$('#toggleMock').textContent,'Start','Stop works without validating a running form');
  concurrent.hold('mock_start');concurrent.click('#toggleMock');await tick();
  assert.equal(concurrent.$('#toggleMock').disabled,true,'Pending action cannot be submitted twice');
  concurrent.click('[data-select-tab="r-get"]');concurrent.fill('#url','https://example.test/typing-while-starting');
  concurrent.release();await tick();await tick();
  assert.equal(concurrent.$('#url').value,'https://example.test/typing-while-starting','Background completion does not erase current request input');
  concurrent.click(`[data-mock-select="${mockId}"]`);assert.equal(concurrent.$('#toggleMock').textContent,'Stop');
  concurrent.hold('mock_stop');concurrent.click('#toggleMock');concurrent.click('[data-select-tab="r-get"]');concurrent.fill('#url','https://example.test/typing-while-stopping');concurrent.release();await tick();await tick();
  assert.equal(concurrent.$('#url').value,'https://example.test/typing-while-stopping');
  concurrent.click(`[data-mock-select="${mockId}"]`);concurrent.hold('mock_status');concurrent.click('#mockRefresh');concurrent.click('[data-select-tab="r-get"]');concurrent.fill('#url','https://example.test/typing-while-refreshing');concurrent.release();await tick();await tick();
  assert.equal(concurrent.$('#url').value,'https://example.test/typing-while-refreshing');
  concurrent.click(`[data-mock-select="${mockId}"]`);concurrent.failSave(true);concurrent.click('#toggleMock');await tick();await tick();
  assert.equal(concurrent.$('#toggleMock').textContent,'Start','Failed persistence prevents start');assert.match(concurrent.$('#mockError').textContent,/disk failure/);
  concurrent.failSave(false);
 }finally{concurrent.release();await concurrent.done()}
 console.log('PASS: collection-linked multiple mock routes, independent responses, CRUD, validation, full start payload and reload');
})().catch(e=>{console.error(e);process.exitCode=1});
