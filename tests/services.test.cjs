const fs=require('node:fs'),assert=require('node:assert/strict');
const {JSDOM,VirtualConsole}=require('jsdom');
(async()=>{
 const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
 const dom=new JSDOM('<div id="app"></div>',{url:'http://localhost/',runScripts:'outside-only',virtualConsole:vc});const w=dom.window;w.TextEncoder=TextEncoder;
 let saved,calls=[];const fixture={collections:[{id:'c',name:'Local collection',folders:[],items:[{id:'r',name:'Local request',method:'POST',url:'http://127.0.0.1:1234/test',params:[],headers:[],bodyType:'raw',rawFormat:'JSON',body:'{"ok":true}'}]}],environments:[],mockServers:[]};
 w.testInvoke=async(command,args)=>{calls.push([command,args]);if(command==='load_workspace')return structuredClone(fixture);if(command==='save_workspace'){saved=JSON.parse(JSON.stringify(args.workspace));return}if(command==='git_status')return 'main';if(command==='service_run')return{id:args.config.id,running:false,port:0,runs:[{at:Date.now(),ok:true,requests:[{method:'POST',url:fixture.collections[0].items[0].url,status:200,time_ms:1}]}]};if(command==='service_start')return{id:args.config.id,running:true,port:44556,runs:[]};if(command==='service_stop')return{id:args.id,running:false,port:44556,runs:[]};if(command==='service_status')return[];throw Error('Unexpected '+command)};
 const modules=['src/assets/postman-icons.js','src/import-request.js','src/import-collection.js','src/code-snippets.js'].map(p=>fs.readFileSync(p,'utf8').replace(/^export /gm,'')).join('\n');const source=fs.readFileSync('src/app.js','utf8').replace(/^import .*;\s*$/gm,'');w.eval('const invoke=window.testInvoke;\n'+modules+'\n'+source);const tick=()=>new Promise(r=>setImmediate(r));await tick();
 const $=s=>w.document.querySelector(s),click=s=>{assert.ok($(s),'Missing '+s);$(s).click()},fill=(s,v)=>{$(s).value=v;$(s).dispatchEvent(new w.Event('input',{bubbles:true}));$(s).dispatchEvent(new w.Event('change',{bubbles:true}))};
 click('[data-view="services"]');
 for(const kind of ['monitors','webhooks','flows']){
   click(`[data-service-toggle="${kind}"]`);assert.ok($(`[data-service-create="${kind}"]`));click(`[data-service-create="${kind}"]`);
   assert.ok($('.canvas .service-workspace-page'));assert.equal($('.sidebar #serviceName'),null);fill('#serviceName','Local '+kind);fill('#serviceCollection','c');click('[data-select-tab="r"]');click(`[data-select-tab="service:${kind}:create"]`);assert.equal($('#serviceName').value,'Local '+kind);
   click('#serviceSave');await tick();const key=kind==='flows'?'deployedFlows':kind;const config=saved[key][0];assert.equal(config.name,'Local '+kind);assert.equal(calls.filter(([c])=>c==='service_run'||c==='service_start').length,0,'Creating configuration must not send requests or start listener');
   click('#serviceRun');await tick();assert.match($('.service-run-list').textContent,/Passed/);assert.equal(calls.at(-2)?.[0]==='save_workspace'||calls.some(([c])=>c==='service_run'),true);
   if(kind!=='monitors'){click('#serviceToggle');await tick();assert.match($('.service-page-form').textContent,/URL/);assert.equal($('#serviceToggle').textContent,'Stop');click('#serviceToggle');await tick();}
   const tab=$('[data-select-tab][aria-selected=true]').dataset.selectTab;click(`[data-close-tab="${tab}"]`);assert.ok($(`[data-service-open="${kind}:${config.id}"]`));click(`[data-service-open="${kind}:${config.id}"]`);assert.equal($('#serviceName').value,'Local '+kind);
   calls=[];
 }
 await tick();assert.deepEqual(errors,[]);dom.window.close();console.log('PASS: all three Services sections expand, create workspace tabs, preserve drafts, persist configs, execute via native commands and reopen');
})().catch(e=>{console.error(e);process.exitCode=1});
