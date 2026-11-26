const fs=require('node:fs'),assert=require('node:assert/strict');
const {JSDOM,VirtualConsole}=require('jsdom');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const fixture=()=>({collections:[{id:'c',name:'Collection',folders:[],items:[{id:'r',name:'Request',method:'GET',url:'http://example.test/',params:[],headers:[],body:''}]}],environments:[],mockServers:[{id:'m',name:'Mock',port:0,routes:[{method:'GET',path:'/',status:200,headers:{},body:'{}'}]}],webhooks:[{id:'wh',name:'Webhook',collectionId:'c',environmentId:'',port:0,path:'/webhook',timeout:30000,delay:0,followRedirects:true,verifySsl:true}],monitors:[],deployedFlows:[]});
async function harness(){
 const errors=[],vc=new VirtualConsole();vc.on('jsdomError',error=>errors.push(error.message));
 const dom=new JSDOM('<div id="app"></div>',{url:'http://localhost/',runScripts:'outside-only',virtualConsole:vc}),w=dom.window;w.TextEncoder=TextEncoder;
 let saved,hold=null,release=null,failSave=false,failStop=false,calls=[];const runtimes=new Map(),mocks=new Map();
 w.testInvoke=async(command,args)=>{calls.push([command,args]);if(command==='load_workspace')return fixture();if(command==='git_status')return '';if(command==='save_workspace'){if(failSave)throw Error('disk failure');saved=structuredClone(args.workspace);return}
  if(command==='service_status')return [...runtimes.values()];if(command==='mock_status')return [...mocks.values()];
  if(command===hold)await new Promise(resolve=>release=resolve);
  if(command==='service_start'){const runtime={id:args.config.id,running:true,port:44556,runs:[]};runtimes.set(runtime.id,runtime);return runtime}
  if(command==='service_stop'){if(failStop)throw Error('stop failure');const runtime={id:args.id,running:false,port:44556,runs:[]};runtimes.set(runtime.id,runtime);return runtime}
  if(command==='service_run')return{id:args.config.id,running:false,runs:[]};
  if(command==='mock_start'){const runtime={id:args.config.id,port:44557,logs:[]};mocks.set(runtime.id,runtime);return runtime}
  if(command==='mock_stop'){if(failStop)throw Error('stop failure');mocks.delete(args.id);return}
  throw Error('Unexpected command '+command)
 };
 const modules=['src/assets/postman-icons.js','src/import-request.js','src/import-collection.js','src/code-snippets.js'].map(p=>fs.readFileSync(p,'utf8').replace(/^export /gm,'')).join('\n');
 w.eval('const invoke=window.testInvoke;\n'+modules+'\n'+fs.readFileSync('src/app.js','utf8').replace(/^import .*;\s*$/gm,''));await tick();
 const $=s=>w.document.querySelector(s),click=s=>{assert.ok($(s),'Missing '+s);$(s).click()},fill=(s,value)=>{$(s).value=value;$(s).dispatchEvent(new w.Event('input',{bubbles:true}));$(s).dispatchEvent(new w.Event('change',{bubbles:true}))};
 return {w,$,click,fill,calls,hold:command=>{hold=command},release:()=>{hold=null;release?.();release=null},failSave:value=>failSave=value,failStop:value=>failStop=value,snapshot:()=>saved,openService:()=>{click('[data-view="services"]');if(!$('[data-service-open="webhooks:wh"]'))click('[data-service-toggle="webhooks"]');click('[data-service-open="webhooks:wh"]')},openMock:()=>{click('[data-view="services"]');click('[data-mock-select="m"]')},close:async()=>{await tick();await tick();assert.deepEqual(errors,[]);dom.window.close()}};
}
(async()=>{
 const h=await harness();
 try{
  h.openService();h.hold('service_start');h.click('#serviceToggle');await tick();
  assert.equal(h.$('#serviceToggle').disabled,true);assert.equal(h.$('#serviceName').disabled,true);assert.equal(h.$('#serviceCollection').closest('fieldset').disabled,true);
  const count=h.calls.filter(([name])=>name==='service_start').length;h.click('#serviceToggle');assert.equal(h.calls.filter(([name])=>name==='service_start').length,count,'Pending Start cannot run twice');
  h.release();await tick();await tick();assert.equal(h.$('#serviceToggle').textContent,'Stop');assert.equal(h.$('#serviceRun').disabled,true,'Run now cannot replace a live listener runtime');assert.equal(h.$('#serviceSave').disabled,true);assert.match(h.$('.service-running-note').textContent,/Stop/);
  h.hold('service_stop');h.click('#serviceDelete');await tick();h.click('[data-select-tab="r"]');h.fill('#url','http://example.test/typed-during-delete');h.release();await tick();await tick();
  assert.ok(h.$('[data-select-tab="r"]'),'Deleting a Service must keep the HTTP tab');assert.equal(h.$('[data-select-tab="service:webhooks:wh"]'),null);assert.equal(h.$('#url').value,'http://example.test/typed-during-delete');assert.equal(h.snapshot().webhooks.length,0);
 }finally{h.release();await h.close()}
 const blocked=await harness();
 try{
  blocked.openService();blocked.failSave(true);blocked.click('#serviceToggle');await tick();await tick();assert.equal(blocked.calls.some(([name])=>name==='service_start'),false,'Saving must succeed before Start');assert.match(blocked.$('#serviceError').textContent,/disk failure/);
  blocked.click('#serviceDelete');await tick();await tick();assert.ok(blocked.$('[data-select-tab="service:webhooks:wh"]'),'Failed deletion save keeps the Service open');assert.match(blocked.$('#serviceError').textContent,/disk failure/);blocked.failSave(false);blocked.click('#serviceSave');await tick();assert.equal(blocked.snapshot().webhooks.length,1,'Failed deletion restores the configuration');
 }finally{blocked.release();await blocked.close()}
 const failed=await harness();
 try{
  failed.openService();failed.click('#serviceToggle');await tick();await tick();failed.failStop(true);failed.hold('service_stop');failed.click('#serviceDelete');await tick();failed.click('[data-select-tab="r"]');failed.fill('#url','http://example.test/keep-after-stop-error');failed.release();await tick();await tick();
  assert.equal(failed.$('#url').value,'http://example.test/keep-after-stop-error');assert.ok(failed.$('[data-select-tab="service:webhooks:wh"]'));failed.click('[data-select-tab="service:webhooks:wh"]');assert.match(failed.$('#serviceError').textContent,/stop failure/);
 }finally{failed.release();await failed.close()}
 const mock=await harness();
 try{
  mock.openMock();mock.fill('#mockName','Renamed Mock');mock.click('#saveMockRoute');await tick();assert.equal(mock.snapshot().mockServers[0].name,'Renamed Mock');assert.equal(mock.$('[data-select-tab="mock:m"] .tab-title').textContent,'Renamed Mock');
  mock.click('#toggleMock');await tick();await tick();mock.hold('mock_stop');mock.click('#deleteMock');await tick();assert.equal(mock.$('#deleteMock').disabled,true);mock.click('[data-select-tab="r"]');mock.fill('#url','http://example.test/typed-during-mock-delete');mock.release();await tick();await tick();assert.ok(mock.$('[data-select-tab="r"]'));assert.equal(mock.$('[data-select-tab="mock:m"]'),null);assert.equal(mock.$('#url').value,'http://example.test/typed-during-mock-delete');assert.equal(mock.snapshot().mockServers.length,0);
 }finally{mock.release();await mock.close()}
 const mockBlocked=await harness();
 try{mockBlocked.openMock();mockBlocked.failSave(true);mockBlocked.click('#deleteMock');await tick();await tick();assert.ok(mockBlocked.$('[data-select-tab="mock:m"]'));assert.match(mockBlocked.$('#mockError').textContent,/disk failure/);mockBlocked.failSave(false);mockBlocked.click('#saveMockRoute');await tick();assert.equal(mockBlocked.snapshot().mockServers.length,1)}finally{mockBlocked.release();await mockBlocked.close()}
 console.log('PASS: Service runtime locks, async target isolation, persistence failures, Mock rename/delete and pending guards');
})().catch(error=>{console.error(error);process.exitCode=1});
