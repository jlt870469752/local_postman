const fs = require('node:fs');
const assert = require('node:assert/strict');
const { JSDOM, VirtualConsole } = require('jsdom');
const tick = () => new Promise(resolve => setImmediate(resolve));
const settle = async () => { for(let i=0;i<6;i++) await tick(); };
const clone = v => structuredClone(v);
const fixture = (name='Local APIs',id='local') => ({collections:[{id:'c-'+id,name,folders:[],items:[{id,name:id+' request',method:'GET',url:'http://example.test/'+id,params:[],headers:[],body:''}]}],environments:[],history:[{id:'history',name:'Local history',method:'GET',url:'http://example.test/previous'}]});
async function harness({connected=false,native=true}={}) {
 const calls=[],saves=[],errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
 const dom=new JSDOM('<div id="app"></div>',{url:'http://localhost/',runScripts:'outside-only',virtualConsole:vc}),w=dom.window;w.TextEncoder=TextEncoder;
 const initial=fixture();if(connected){initial.gitRepository='/test/repo';initial.gitWorkspaceRevision='r1';}
 let repo={path:'/test/repo',status:'## main',revision:'r1',workspace:fixture('Remote APIs','remote'),output:'',error:null}, failSave=false,external=false, syncResult=null,hold=null,release;
 w.testInvoke=async(command,args)=>{
  calls.push({command,args:clone(args)});
  if(command==='load_workspace')return clone(initial);
  if(command==='save_workspace'){if(failSave)throw Error('disk full');saves.push(clone(args.workspace));return;}
  if(command==='git_status')return 'main';
  if(command==='service_status'||command==='mock_status')return [];
  if(command==='git_choose_folder')return '/test/repo';
  if(command===hold)await new Promise(resolve=>release=resolve);
  if(command==='git_open')return clone(repo);
  if(command==='git_preview')return {path:repo.path,status:repo.status,revision:repo.revision,diff:'-before\n+after',hasChanges:true,externallyChanged:external};
  if(command==='git_sync')return clone(syncResult||{...repo,revision:'r2',output:'Committed'});
  if(command==='git_pull')return clone(repo);
  throw Error('Unexpected '+command);
 };
 if(native)w.__TAURI_INTERNALS__={};
 const modules=['src/assets/postman-icons.js','src/import-request.js','src/import-collection.js','src/code-snippets.js'].map(p=>fs.readFileSync(p,'utf8').replace(/^export /gm,'')).join('\n');
 w.eval('const invoke=window.testInvoke;const listen=()=>Promise.resolve();const getCurrentWindow=()=>({onCloseRequested(){}});\n'+modules+'\n'+fs.readFileSync('src/app.js','utf8').replace(/^import .*;\s*$/gm,''));
 await settle();
 const $=s=>w.document.querySelector(s),click=s=>{assert.ok($(s),'Missing '+s);$(s).click();},fill=(s,value)=>{assert.ok($(s));$(s).value=value;$(s).dispatchEvent(new w.Event('input',{bubbles:true}));};
 return {w,$,click,fill,calls,saves,repo(value){repo={...repo,...value}},external(value){external=value},failSave(value){failSave=value},syncResult(value){syncResult=value},hold(command){hold=command},release(){hold=null;release()},snapshot(){return saves.at(-1)||initial},async close(){await settle();assert.deepEqual(errors,[]);dom.window.close()}};
}
(async()=>{
 const open=await harness();try{
  open.click('[data-view="git"]');await settle();const before=open.saves.length;
  open.click('#openGitFolder');await settle();assert.ok(open.$('#gitReviewBackdrop'));assert.equal(open.snapshot().gitRepository,undefined,'Opening is read-only until the review choice');assert.equal(open.calls.filter(c=>c.command==='git_sync').length,0);
  open.click('#keepGitWorkspace');await settle();assert.equal(open.snapshot().gitRepository,'/test/repo');assert.equal(open.snapshot().gitWorkspaceRevision,'r1');assert.equal(open.snapshot().collections[0].name,'Local APIs');assert.ok(open.saves.length>before);
 }finally{await open.close()}
 console.log('PASS: Open Folder reviews the repository and keeps current data only on explicit choice');
 const load=await harness();try{
  load.click('[data-view="git"]');load.click('#openGitFolder');await settle();load.click('#loadGitWorkspace');await settle();assert.equal(load.snapshot().collections[0].name,'Remote APIs');assert.equal(load.snapshot().history[0].name,'Local history');assert.equal(load.$('#requestName').value,'remote request');assert.equal(load.$('#gitReviewBackdrop'),null);
 }finally{await load.close()}
 const dirty=await harness();try{
  dirty.fill('#requestName','Unsaved local request');dirty.click('[data-view="git"]');dirty.click('#openGitFolder');await settle();dirty.click('#loadGitWorkspace');await settle();assert.match(dirty.w.document.body.textContent,/Save or discard unsaved/);assert.equal(dirty.snapshot().collections[0].items[0].name,'Unsaved local request');assert.ok(dirty.$('#gitReviewBackdrop'));
 }finally{await dirty.close()}
 console.log('PASS: Loading repository data preserves local history and refuses to replace unsaved requests');
 const commit=await harness({connected:true});try{
  commit.click('[data-view="git"]');const start=commit.calls.length;commit.click('#gitPanelCommit');await settle();assert.match(commit.$('.git-diff').textContent,/before/);const preview=commit.calls.findIndex((c,i)=>i>=start&&c.command==='git_preview');assert.ok(commit.calls.slice(start,preview).some(c=>c.command==='save_workspace'),'Commit preview waits for latest save');assert.equal(commit.calls[preview].args.expectedRevision,'r1');assert.equal(commit.calls.filter(c=>c.command==='git_sync').length,0);
  commit.click('#confirmGitCommit');await settle();const sent=commit.calls.find(c=>c.command==='git_sync');assert.equal(sent.args.expectedRevision,'r1');assert.equal(sent.args.push,false);assert.equal(commit.snapshot().gitWorkspaceRevision,'r2');assert.match(commit.$('#gitPanelOutput').textContent,/Committed/);assert.equal(commit.$('#gitReviewBackdrop'),null);
 }finally{await commit.close()}
 console.log('PASS: Commit previews saved data and sends the reviewed repository revision');
 const external=await harness({connected:true});try{
  external.external(true);external.click('[data-view="git"]');external.click('#gitPanelCommit');await settle();assert.equal(external.$('#confirmGitCommit').disabled,true);external.click('#confirmGitCommit');await settle();assert.equal(external.calls.filter(c=>c.command==='git_sync').length,0);
 }finally{await external.close()}
 const failed=await harness({connected:true});try{
  failed.click('[data-view="git"]');failed.syncResult({path:'/test/repo',status:'## main',revision:'r2',output:'Committed',error:'GIT_PUSH_FAILED: offline'});failed.click('#gitPanelSync');await settle();failed.click('#confirmGitCommit');await settle();assert.equal(failed.snapshot().gitWorkspaceRevision,'r2');assert.match(failed.$('#gitPanelOutput').textContent,/GIT_PUSH_FAILED/);
  failed.repo({revision:'r2'});failed.click('#gitPanelSync');await settle();assert.equal(failed.calls.filter(c=>c.command==='git_preview').at(-1).args.expectedRevision,'r2');
 }finally{await failed.close()}
 console.log('PASS: External changes block commits and push failures retain the retry revision');
 const pull=await harness({connected:true});try{
  pull.repo({revision:'r3',workspace:fixture('Pulled APIs','pulled'),output:'Fast-forward'});pull.click('[data-view="git"]');pull.click('#gitPanelPull');await settle();assert.equal(pull.calls.find(c=>c.command==='git_pull').args.expectedRevision,'r1');assert.equal(pull.snapshot().collections[0].name,'Pulled APIs');assert.equal(pull.snapshot().history[0].name,'Local history');assert.equal(pull.snapshot().gitWorkspaceRevision,'r3');
 }finally{await pull.close()}
 const saving=await harness({connected:true});try{
  saving.click('[data-view="git"]');saving.failSave(true);saving.click('#gitPanelCommit');await settle();assert.equal(saving.calls.filter(c=>c.command==='git_preview').length,0);assert.match(saving.w.document.body.textContent,/disk full/);
 }finally{await saving.close()}
 console.log('PASS: Pull loads the returned workspace and failed saves prevent Git commands');
 const busy=await harness({connected:true});try{
  busy.fill('#requestName','Keep this draft');const editor=busy.$('#requestName');busy.hold('git_preview');busy.click('#gitSync');await settle();assert.equal(busy.$('#app').inert,true);assert.equal(busy.$('#gitSync').disabled,true);busy.click('#gitSync');assert.equal(busy.calls.filter(c=>c.command==='git_preview').length,1);busy.release();await settle();assert.equal(busy.$('#app').inert,false);assert.equal(busy.$('#requestName'),editor,'Async completion must preserve active editor DOM');assert.equal(busy.$('#requestName').value,'Keep this draft');
 }finally{await busy.close()}
 const browser=await harness({native:false});try{browser.click('[data-view="git"]');browser.click('#openGitFolder');await settle();assert.match(browser.w.document.body.textContent,/require the desktop client/);assert.equal(browser.calls.filter(c=>c.command==='git_choose_folder').length,0)}finally{await browser.close()}
 console.log('PASS: Git operations prevent duplicate submissions, preserve editors and explain browser limitations');
})().catch(error=>{console.error(error);process.exitCode=1});
