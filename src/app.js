import { setLanguage, translateUi, observeUi } from './i18n.js';
import { createSettingsPanel, defaultSettings } from './settings-panel.js';
import { generateCodeSnippet, snippetLanguages } from './code-snippets.js';
import { parseCurl } from './import-request.js';
import { parseCollection } from './import-collection.js';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { postmanIcons } from './assets/postman-icons.js';
import { invoke } from './runtime.js';
const seed={collections:[{id:'c1',name:'Demo APIs',items:[{id:'r1',name:'Get a user',method:'GET',url:'https://jsonplaceholder.typicode.com/users/1',headers:{},params:{},body:''},{id:'r2',name:'Create a post',method:'POST',url:'https://jsonplaceholder.typicode.com/posts',headers:{'Content-Type':'application/json'},params:{},body:'{\n  "title": "LocalPostman",\n  "body": "hello",\n  "userId": 1\n}'}]}],history:[],environments:[{id:'e1',name:'Local',values:{baseUrl:'http://localhost:3000',token:''}}]};
const headerKeySuggestions=['Accept','Accept-Charset','Accept-Encoding','Accept-Language','Access-Control-Request-Headers','Access-Control-Request-Method','Authorization','Cache-Control','Connection','Content-Length','Content-Type','Cookie','Date','Expect','Forwarded','Host','If-Match','If-Modified-Since','If-None-Match','If-Unmodified-Since','Origin','Pragma','Proxy-Authorization','Range','Referer','TE','Trailer','Transfer-Encoding','User-Agent','Upgrade','Via','Warning','WWW-Authenticate','X-API-Key','X-CSRF-Token','X-Correlation-ID','X-Forwarded-For','X-Request-ID','X-Requested-With','X-RateLimit-Limit','X-RateLimit-Remaining','X-RateLimit-Reset'];
let state=normalizeWorkspace(JSON.parse(JSON.stringify(seed))), view='collections', activeTab='Params', response=null, responseView='Pretty', showEnv=false, envDraft=null;
let appSettings=typeof defaultSettings==='undefined'?{general:{},shortcuts:{enabled:true}}:JSON.parse(JSON.stringify(defaultSettings)),settingsPanel=null;
let envSession=new Map(),envError='',envSaving=false,envDeletePrompt=false;
let layoutMenuOpen=false, selectedMockId='', selectedRoute=0, mockRuntime={}, mockDraft=null;
const mockRouteSelections={},mockErrors={};
const mockPending=new Set();
const mockCreateTabId='mock-create';
const isMockTab=(id=selectedTab)=>id===mockCreateTabId||id.startsWith('mock:')||id.startsWith('service:');
const layoutDefaults={sidebarVisible:true,sidebarSide:'left',sidebarWidth:240,twoPane:false,requestRatio:52};
let layout={...layoutDefaults};try{layout={...layoutDefaults,...JSON.parse(localStorage.getItem('localpostman-layout')||'{}')}}catch{}
let importCompletion=null, importPriorFocus=null, importSession=0, activeHeaderSuggest=null;
let showImport=false, importText='', importError='', showSnippet=false, snippetLang='curl', showSave=false, saveCollectionFilter='';
let servicesMenuOpen=false, treeMenu=null, entityDialog=null, treeSelection=null;
let gitPanelOutput='', gitCommitMessage='Update LocalPostman workspace', gitBusy=false, gitReview=null;
let workspaceCatalog=[{id:'default',name:'My Workspace',active:true}],workspaceMenuOpen=false,workspaceFilter='',workspaceDialog=null,workspaceBusy=false;
let workspaceError='', workspaceRecovery=null, persistTimer=null, persistencePending=false, lastPersist=Promise.resolve();
const expandedFolders=new Set();
let collectionsExpanded=true;
let saveNameDraft='';
let closePromptTarget=null, saveCloseTarget=null, saveRequestId=null, saveError='', saveInProgress=false;
const requestBaselines=new Map();
let alwaysDiscardUnsaved=false;
try{alwaysDiscardUnsaved=localStorage.getItem('localpostman-always-discard-unsaved')==='true'}catch{}
let sidebarFilter='', collapsedCollections=new Set(), expandedSections=new Set(), bulkEditors=new Set(), tabResponses={};
let openTabs=[seed.collections[0].items[0].id], selectedTab=seed.collections[0].items[0].id, idSequence=0;
const uniqueId=prefix=>`${prefix}${Date.now().toString(36)}${(++idSequence).toString(36)}`;
const cloneRequest=r=>JSON.parse(JSON.stringify(r));
function setRequestBaseline(r){if(r)requestBaselines.set(r.id,cloneRequest(r))}
function markRequestUnsaved(r){if(r)requestBaselines.set(r.id,null)}
function requestFingerprint(request){
 const r=cloneRequest(request);
 for(const key of ['params','headers','bodyFields'])r[key]=mapRows(r[key]).filter(row=>String(row.key||'').trim()).map(row=>({...row,key:String(row.key),value:String(row.value??''),enabled:row.enabled!==false,description:row.description||''}));
 r.folderId=r.folderId||null;r.bodyType=r.bodyType||'raw';r.rawFormat=r.rawFormat||'JSON';
 for(const key of ['body','description','tests','graphqlQuery','graphqlVariables','binaryName'])r[key]=r[key]||'';
 r.binaryBytes=r.binaryBytes||[];r.auth={type:'No Auth',...r.auth};
 if(r.auth.type==='API Key')r.auth={key:'',value:'',location:'header',...r.auth};
 if(r.auth.type==='Bearer Token')r.auth={token:'',...r.auth};
 if(r.auth.type==='Basic Auth')r.auth={username:'',password:'',...r.auth};
 r.settings={timeout:0,followRedirects:true,verifySsl:true,...r.settings};updateQuery(r);
 const ordered=value=>Array.isArray(value)?value.map(ordered):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,ordered(value[key])])):value;
 return JSON.stringify(ordered(r));
}
function isRequestDirty(id,request=null){const r=request||reqs().find(x=>x.id===id),baseline=requestBaselines.get(id);return !!r&&(baseline===null||(baseline!==undefined&&requestFingerprint(r)!==requestFingerprint(baseline)))}
function isEmptyUnsavedRequest(request){
 if(!request||requestBaselines.get(request.id)!==null)return false;
 const hasText=value=>String(value??'').trim().length>0;
 if(hasText(request.url)||hasText(request.name)&&request.name.trim()!=='Untitled Request'||(request.method||'GET')!=='GET')return false;
 if(['body','description','tests','preRequestScript','graphqlQuery','graphqlVariables','binaryName'].some(key=>hasText(request[key])))return false;
 if((request.binaryBytes||[]).length||(request.examples||[]).length)return false;
 if(['params','headers','bodyFields','variables'].some(key=>mapRows(request[key]).some(row=>['key','value','description','src'].some(field=>hasText(row[field])))))return false;
 if(request.bodyType&&!['raw','none'].includes(request.bodyType)||request.rawFormat&&request.rawFormat!=='JSON')return false;
 if(request.auth&&((request.auth.type||'No Auth')!=='No Auth'||Object.entries(request.auth).some(([key,value])=>key!=='type'&&hasText(value))))return false;
 return !Object.keys(request.settings||{}).length;
}
function workspaceSnapshot(){
 const workspace=cloneRequest(state),baselines={};
 const requests=reqs(),ids=new Set(requests.map(r=>r.id));for(const r of requests){if(!requestBaselines.has(r.id))setRequestBaseline(r);if(isRequestDirty(r.id,r))baselines[r.id]=requestBaselines.get(r.id)}
 workspace.editorSession={requestBaselines:cloneRequest(baselines),openRequestTabs:openTabs.filter(id=>ids.has(id)),selectedRequestTab:selectedTab};
 normalizeWorkspaceAuth(workspace);
 return workspace;
}
function restoreRequestSession(){
 requestBaselines.clear();const session=state.editorSession||{},stored=session.requestBaselines||{};
 for(const r of reqs()){const baseline=Object.hasOwn(stored,r.id)?stored[r.id]:r;requestBaselines.set(r.id,baseline===null?null:cloneRequest(baseline&&baseline.id===r.id?baseline:r))}
 const ids=new Set(reqs().map(r=>r.id));openTabs=Array.isArray(session.openRequestTabs)?[...new Set(session.openRequestTabs.filter(id=>ids.has(id)))]:reqs()[0]?[reqs()[0].id]:[];
 for(const r of reqs())if(isRequestDirty(r.id,r)&&!openTabs.includes(r.id))openTabs.push(r.id);
 selectedTab=openTabs.includes(session.selectedRequestTab)?session.selectedRequestTab:openTabs[0]||'';
}
function refreshDirtyTabs(){document.getElementById('requestTabStrip')?.querySelectorAll('[data-select-tab]').forEach(tab=>{const dirty=isRequestDirty(tab.dataset.selectTab);tab.classList.toggle('is-dirty',dirty);tab.querySelector('.tab-dirty')?.setAttribute('aria-hidden',String(!dirty))})}
const $=s=>/^#[\w-]+$/.test(s)?document.getElementById(s.slice(1)):document.querySelector(s), esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function normalizeWorkspaceAuth(workspace){
 const normalize=request=>{if(request&&typeof request==='object'&&!Array.isArray(request)&&request.auth==null)request.auth={type:'No Auth'}};
 for(const collection of workspace.collections||[])for(const request of collection.items||[])normalize(request);
 for(const request of workspace.history||[])normalize(request);
 for(const request of Object.values(workspace.editorSession?.requestBaselines||{}))normalize(request);
 return workspace;
}
function variableNames(){return [...new Set([...state.environments.flatMap(e=>Object.keys(e.values||{})),...Object.keys(environmentValues())])];} function normalizeWorkspace(w){w.collections=w.collections||seed.collections;w.history=w.history||[];w.collections.forEach(c=>{c.items=c.items||[];c.folders=c.folders||[];c.items.forEach(r=>{if(!mapRows(r.params).length)paramsFromUrl(r);if(r.folderId===undefined)r.folderId=null})});w.environments=w.environments||[];w.mockServers=w.mockServers||[];w.monitors=w.monitors||[];w.webhooks=w.webhooks||[];w.deployedFlows=w.deployedFlows||[];return normalizeWorkspaceAuth(w);} const reqs=()=>state.collections.flatMap(c=>c.items);const current=()=>reqs().find(r=>r.id===selectedTab)||reqs()[0];function cancelScheduledPersistence(){if(persistTimer!==null)clearTimeout(persistTimer);persistTimer=null;persistencePending=false}
function flushPersistence(strict=false){
 if(workspaceError){const error=Error(workspaceError);return strict?Promise.reject(error):Promise.resolve()}
 cancelScheduledPersistence();
 const save=invoke('save_workspace',{workspace:workspaceSnapshot(),workspaceId:workspaceCatalog.find(w=>w.active)?.id});lastPersist=save;save.catch(()=>{});
 return strict?save:save.catch(e=>toast(`保存失败：${e}`));
}
function persist({defer=false}={}){
 if(workspaceError)return Promise.resolve();
 if(defer){persistencePending=true;if(persistTimer!==null)clearTimeout(persistTimer);persistTimer=setTimeout(()=>flushPersistence(),300);return lastPersist.catch(()=>{})}
 return flushPersistence();
}
function icon(name){return `<svg class="ui-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">${postmanIcons[name]||postmanIcons.folder}</svg>`}function toast(text){const n=document.createElement('div');n.className='notice';n.textContent=text;document.body.append(n);setTimeout(()=>n.remove(),2600)}
function render({captureEnvironment=true}={}){closeHeaderSuggest();if(captureEnvironment&&showEnv&&$('#envName'))captureEnvDraft();if(workspaceError){renderWorkspaceRecovery();return}const r=reqs().find(x=>x.id===selectedTab);document.getElementById('importOverlay')?.remove();document.querySelector('#app').innerHTML=`<datalist id="variableSuggestions">${variableNames().map(x=>`<option value="{{${esc(x)}}}"></option>`).join('')}</datalist><datalist id="headerSuggestions">${headerKeySuggestions.map(value=>`<option value="${esc(value)}"></option>`).join('')}</datalist><div class="shell ${layout.sidebarVisible?'':'sidebar-hidden'} ${layout.sidebarSide==='right'?'sidebar-right':''}" style="--sidebar-width:${layout.sidebarWidth}px;--request-ratio:${layout.requestRatio}%"><header class="globalbar" data-tauri-drag-region><div class="window-controls-space" data-tauri-drag-region aria-hidden="true"></div><button id="workspaceMenu" class="workspace" aria-haspopup="menu" aria-expanded="${workspaceMenuOpen}">⌂　${esc(workspaceCatalog.find(w=>w.active)?.name||'My Workspace')}　⌄</button><button id="appSettings" class="app-settings-button" title="Settings (⌘,)" aria-label="Settings">${icon('settings')}</button></header><div class="body"><aside class="sidebar ${view==='services'?'services-sidebar':''} ${view==='collections'&&!collectionsExpanded?'collections-collapsed':''}"><div class="sidebar-toolbar">${nav('collections','Collections')}${nav('services','Services')}${nav('history','History')}${nav('git','Git')}</div><div class="filterrow"><label class="sidebar-filter">${icon('filter')}<input id="sidebarFilter" aria-label="Filter items" value="${esc(sidebarFilter)}"/></label><button id="addRequest" title="New request">${icon('add')}</button>${view==='services'?`<div class="services-actions"><button id="servicesMore" title="More panel actions" aria-label="More panel actions" aria-expanded="${servicesMenuOpen}">${icon('more')}</button>${servicesMenuOpen?'<div class="services-actions-menu" role="menu"><button id="importWorkspace" role="menuitem">Import…</button></div>':''}</div>`:`<button id="importWorkspace" title="Import collection or environment">${icon('import')}</button>`}</div>${sidebar()}</aside><div id="sidebarSplitter" class="sidebar-splitter" role="separator" aria-label="Resize sidebar" aria-orientation="vertical" tabindex="0"></div><main id="requestCanvas" class="canvas ${isMockTab()?'mock-workspace':layout.twoPane?'two-pane':'stacked'}">${workspaceTabbar()}${serviceTabInfo(selectedTab)?servicePage():selectedTab===mockCreateTabId?mockDeployPage():selectedTab.startsWith('mock:')?mockDetailPage():r?requestWorkspace(r):emptyWorkspace()}</main></div><footer class="statusbar"><span>◒</span><span id="gitStatus">Git: checking…</span><span class="status-spacer"></span><button id="gitConfigure">Git repository</button><button id="gitSync">Push changes</button><div class="layout-controls"><button id="toggleSidebar" title="Toggle left sidebar (⌘\\)" aria-label="Toggle sidebar" aria-pressed="${layout.sidebarVisible}">◧</button><button id="toggleTwoPane" title="Two-pane response view (⌥⌘V)" aria-label="Two-pane response view" aria-pressed="${layout.twoPane}">◫</button><button id="layoutMenuButton" title="Layout options" aria-label="Layout options" aria-expanded="${layoutMenuOpen}">${icon('layout')}</button>${layoutMenuOpen?layoutMenu():''}</div></footer>${showEnv?envDialog():''}${showImport?importDialog():''}${showSnippet&&!isMockTab()&&r?snippetPanel():''}${showSave?saveDialog():''}${closePromptTarget?closePromptDialog():''}${treeMenu?treeMenuPanel():''}${entityDialog?entityDialogPanel():''}</div>`;mountImportDialog();bind();applyAppPreferences();localizeApplication();status()}
function requestWorkspace(r){return `<header class="request-header"><div class="crumbs"><span>${esc(collectionName(r))} / <input id="requestName" class="request-name" aria-label="Request name" title="Click to rename request" value="${esc(r.name)}" readonly autocomplete="off" spellcheck="false"/></span><button class="save-button" id="save">${icon('save')} Save</button></div><div class="request-line"><select id="method" class="method-select">${[...new Set(['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS',r.method])].map(m=>`<option ${m===r.method?'selected':''}>${m}</option>`).join('')}</select><input id="url" class="url-input" value="${esc(r.url)}" list="variableSuggestions" placeholder="Enter URL or paste text"/><button id="send" class="send-button" ${requestPending.has(r.id)?'disabled aria-busy="true"':''}>${requestPending.has(r.id)?'Sending…':'Send'}</button><button id="codeSnippet" class="code-snippet-toggle" title="Code" aria-label="Code snippet" aria-pressed="${showSnippet}">&lt;/&gt;</button></div></header><div class="workbench"><section class="request-pane"><div class="builder-tabs">${['Docs','Params','Authorization','Headers','Body',...(r.tests||r.preRequestScript?['Scripts']:[]),'Settings'].map(t=>`<button data-builder="${t}" class="${activeTab===t?'active':''}">${t}${t==='Headers'&&mapRows(r.headers).filter(x=>x.key).length?` <b>${Object.keys(r.headers).length}</b>`:''}</button>`).join('')}</div><div class="builder-body">${builder(r)}</div></section><div id="responseSplitter" class="response-splitter" role="separator" aria-label="Resize request and response" aria-orientation="${layout.twoPane?'vertical':'horizontal'}" tabindex="0"></div><section class="response-pane"><div class="response-toolbar"><div><strong>Response</strong>${response?` <i class="ok-dot ${response.ok?'good':'bad'}"></i><span class="response-meta">${response.status}　${response.time_ms} ms</span>`:''}</div><div><button id="saveResponse">Save Response</button></div></div>${response?responsePanel():`<div class="response-empty"><div class="empty-logo">◇</div><strong>Send a request to get started</strong><span>The response will appear here.</span></div>`}</section></div>`}
function workspaceTabbar(){return `<div class="tabbar"><div id="requestTabStrip" class="tabs-scroll" role="tablist" aria-label="Open requests">${openTabs.map(id=>{const q=reqs().find(x=>x.id===id),m=id.startsWith('mock:')?state.mockServers?.find(x=>x.id===id.slice(5)):null;const title=id===mockCreateTabId?'Deploy mock server':m?.name||q?.name||serviceTitle(id);if(!title)return '';return `<button class="request-tab ${id===selectedTab?'selected':''} ${q&&isRequestDirty(id)?'is-dirty':''}" data-select-tab="${esc(id)}" role="tab" aria-selected="${id===selectedTab}" title="${esc(title)}">${q?`<span class="method-tag ${q.method.toLowerCase()}">${esc(q.method)}</span>`:icon('services')}<span class="tab-title">${esc(title)}</span>${q?`<span class="tab-dirty" aria-label="Unsaved changes" aria-hidden="${!isRequestDirty(id)}"></span>`:''}<span class="tab-close" data-close-tab="${esc(id)}" role="button" aria-label="Close ${esc(title)}">${icon('close')}</span></button>`}).join('')}</div><button class="new-tab" id="newTab" title="New request">${icon('add')}</button><div class="tabbar-right"><div class="env-picker"><select class="env" id="envSelect" aria-label="Active environment"><option value="">No Environment</option>${state.environments.map(e=>`<option value="${e.id}" ${e.id===state.activeEnvironmentId?'selected':''}>${esc(e.name)}</option>`).join('')}</select><svg class="env-chevron" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4.5 6.5 3.5 3.5 3.5-3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></div><button class="env-manager" id="envButton" title="Manage environments" aria-label="Manage environments"><svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2.5 5h3m3 0h5m-11 6h7m3 0h1" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/><circle cx="7" cy="5" r="1.5" stroke="currentColor" stroke-width="1.25"/><circle cx="11" cy="11" r="1.5" stroke="currentColor" stroke-width="1.25"/></svg></button></div></div>`}
function selectWorkspaceTab(id){if(!openTabs.includes(id))return;try{sync()}catch(e){toast(e.message);return}selectedTab=id;if(id.startsWith('mock:'))selectedMockId=id.slice(5);response=tabResponses[id]||null;persist();render()}
function removeWorkspaceTab(id){const index=openTabs.indexOf(id);if(index<0)return;openTabs.splice(index,1);delete tabResponses[id];if(id===mockCreateTabId)mockDraft=null;const service=serviceTabInfo(id);if(service?.id==='create')delete serviceDrafts[service.kind];if(!openTabs.length){selectedTab='';response=null;persist();render();return}if(selectedTab===id)selectedTab=openTabs[Math.max(0,index-1)];if(selectedTab.startsWith('mock:'))selectedMockId=selectedTab.slice(5);response=tabResponses[selectedTab]||null;persist();render()}
function closeWorkspaceTab(id){try{sync()}catch(e){toast(e.message);return}const request=reqs().find(r=>r.id===id);if(isEmptyUnsavedRequest(request)){discardRequestAndClose(id);return}if(!id.startsWith('mock:')&&!id.startsWith('service:')&&request&&isRequestDirty(id)){if(alwaysDiscardUnsaved||appSettings.general.alwaysAskClosingUnsavedTabs===false){discardRequestAndClose(id);return}closePromptTarget=id;render();return}removeWorkspaceTab(id)}
function discardRequestAndClose(id){
 const r=reqs().find(x=>x.id===id),baseline=requestBaselines.get(id);
 if(r){const owner=state.collections.find(c=>c.items.some(x=>x.id===id));if(owner){const index=owner.items.findIndex(x=>x.id===id);if(baseline===null){owner.items.splice(index,1);requestBaselines.delete(id)}else if(baseline)owner.items[index]=cloneRequest(baseline)}}
 closePromptTarget=null;removeWorkspaceTab(id);
}
function closePromptDialog(){const r=reqs().find(x=>x.id===closePromptTarget),label=r?.url||r?.name||'This request';return `<div class="modal-backdrop unsaved-backdrop"><div class="unsaved-modal" role="dialog" aria-modal="true" aria-labelledby="unsavedTitle"><header><strong id="unsavedTitle">Save changes?</strong><button id="closeUnsaved" aria-label="Close">${icon('close')}</button></header><p><strong>${esc(label.length>52?label.slice(0,52)+'…':label)}</strong> has unsaved changes. Save these changes to avoid losing your work.</p><label class="discard-preference"><input id="alwaysDiscardUnsaved" type="checkbox" ${alwaysDiscardUnsaved?'checked':''}/> <span>Always discard unsaved changes when closing a tab</span><span title="Closing a tab will discard its changes without asking. Turn this off in Layout options.">ⓘ</span></label><footer><button id="discardUnsaved">Don't save</button><span></span><button id="cancelUnsaved">Cancel</button><button id="saveUnsaved" class="save-primary">Save changes</button></footer></div></div>`}

function openMockCreate(){try{sync()}catch(e){toast(e.message);return}if(!openTabs.includes(mockCreateTabId)){openTabs.push(mockCreateTabId);mockDraft={name:'New mock server',type:state.mockServers.length?'existing':'collection',sourceId:'',port:0}}selectedTab=mockCreateTabId;render()}
function openMockServer(id){try{sync()}catch(e){toast(e.message);return}const tabId='mock:'+id;if(!openTabs.includes(tabId))openTabs.push(tabId);selectedMockId=id;selectedTab=tabId;render()}

function layoutMenu(){return `<div class="layout-menu" role="menu" aria-label="Layout">${[['twoPane','Two-pane response view','⌥⌘V',layout.twoPane],['sidebar','Left sidebar','⌘\\',layout.sidebarVisible],['swap','Swap left and right sidebar','⌥⌘S',false],['reset','Reset layout','⌥⌘R',false],['discard','Always discard unsaved changes','',alwaysDiscardUnsaved]].map(([action,label,key,checked])=>`<button role="menuitem" data-layout="${action}"><span>${checked?'✓':''}</span>${label}<kbd>${key}</kbd></button>`).join('')}</div>`}
function saveLayout(){try{localStorage.setItem('localpostman-layout',JSON.stringify(layout))}catch{}}
function changeLayout(action){sync();if(action==='twoPane')layout.twoPane=!layout.twoPane;if(action==='sidebar')layout.sidebarVisible=!layout.sidebarVisible;if(action==='swap')layout.sidebarSide=layout.sidebarSide==='left'?'right':'left';if(action==='reset')layout={...layoutDefaults};if(action==='discard'){alwaysDiscardUnsaved=!alwaysDiscardUnsaved;try{localStorage.setItem('localpostman-always-discard-unsaved',String(alwaysDiscardUnsaved))}catch{}}layoutMenuOpen=false;saveLayout();render()}
function bindLayout(){
 $('#toggleSidebar').onclick=()=>changeLayout('sidebar');$('#toggleTwoPane').onclick=()=>changeLayout('twoPane');$('#layoutMenuButton').onclick=()=>{sync();layoutMenuOpen=!layoutMenuOpen;render()};document.querySelectorAll('[data-layout]').forEach(b=>b.onclick=()=>changeLayout(b.dataset.layout));
 const bindSplitter=(id,update)=>{const el=$(id);if(!el)return;el.onpointerdown=e=>{if(e.button!==0)return;e.preventDefault();el.setPointerCapture?.(e.pointerId);document.body.classList.add('resizing');const move=event=>update(event);const stop=()=>{document.body.classList.remove('resizing');el.removeEventListener('pointermove',move);el.removeEventListener('pointerup',stop);el.removeEventListener('pointercancel',stop);saveLayout()};el.addEventListener('pointermove',move);el.addEventListener('pointerup',stop);el.addEventListener('pointercancel',stop)};el.ondblclick=()=>{if(id==='#sidebarSplitter')layout.sidebarWidth=240;else layout.requestRatio=52;saveLayout();render()};el.onkeydown=e=>{const step=e.shiftKey?10:2;if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();const positive=['ArrowRight','ArrowDown'].includes(e.key);if(id==='#sidebarSplitter')layout.sidebarWidth=Math.max(180,Math.min(480,layout.sidebarWidth+(positive?step:-step)));else layout.requestRatio=Math.max(25,Math.min(75,layout.requestRatio+(positive?step:-step)));saveLayout();sync();render();$(id).focus()}}};
 bindSplitter('#sidebarSplitter',e=>{const rect=$('.body').getBoundingClientRect();layout.sidebarWidth=Math.max(180,Math.min(480,rect.width*.45,layout.sidebarSide==='left'?e.clientX-rect.left:rect.right-e.clientX));$('.shell').style.setProperty('--sidebar-width',layout.sidebarWidth+'px')});
 bindSplitter('#responseSplitter',e=>{const rect=$('.workbench').getBoundingClientRect();const ratio=layout.twoPane?(e.clientX-rect.left)/rect.width:(e.clientY-rect.top)/rect.height;layout.requestRatio=Math.max(25,Math.min(75,ratio*100));$('.shell').style.setProperty('--request-ratio',layout.requestRatio+'%')});
}
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&layoutMenuOpen){layoutMenuOpen=false;sync();render()}if(!(e.metaKey||e.ctrlKey)||showEnv||showImport||showSave||closePromptTarget)return;const key=e.key.toLowerCase();const action=key==='\\'&&!e.altKey?'sidebar':e.altKey?({v:'twoPane',s:'swap',r:'reset'})[key]:null;if(action){e.preventDefault();changeLayout(action)}});
function nav(id,label){return `<button class="nav-icon ${view===id?'is-active':''}" data-view="${id}" title="${label}" aria-label="${label}">${icon(id)}</button>`}
function treeRow(kind,c,item,content,depth=0){const id=item.id,selected=kind==='request'?id===selectedTab:treeSelection?.kind===kind&&treeSelection.id===id;return `<div class="tree-row ${selected?'selected':''}" data-entity-kind="${kind}" data-collection-id="${esc(c.id)}" data-entity-id="${esc(id)}" style="--tree-indent:${depth*16}px">${content}<button class="tree-more" data-tree-menu title="View more actions" aria-label="Actions for ${esc(item.name)}" aria-haspopup="menu">${icon('more')}</button></div>`}
function emptyWorkspace(){return `<section class="workspace-empty"><div>${icon('collections')}</div><h2>Open a request to get started</h2><p>Select a request from Collections or create a new one.</p><button id="emptyNewRequest">${icon('add')} New request</button></section>`}
function folderPath(c,id){const names=[],seen=new Set();while(id&&!seen.has(id)){seen.add(id);const f=(c.folders||[]).find(f=>f.id===id);if(!f)break;names.unshift(f.name);id=f.parentId}return names.join(' / ')}
function revealFolder(c,id){const seen=new Set();while(id&&!seen.has(id)){seen.add(id);expandedFolders.add(id);id=c.folders?.find(f=>f.id===id)?.parentId}}
function entityRef(kind,collectionId,id){const c=state.collections.find(c=>c.id===collectionId);const item=kind==='collection'?c:kind==='folder'?c?.folders?.find(f=>f.id===id):c?.items.find(r=>r.id===id);return {c,item}}
function folderDescendants(c,id){const ids=new Set([id]);let changed=true;while(changed){changed=false;for(const f of c.folders||[])if(ids.has(f.parentId)&&!ids.has(f.id)){ids.add(f.id);changed=true}}return ids}
function treeMenuPanel(){const {kind,x,y}=treeMenu;const actions=[...(kind!=='request'?[['add-request','Add request'],['add-folder','Add folder']]:[]),['edit','Edit'],['rename','Rename'],['duplicate','Duplicate'],...(kind!=='collection'?[['move','Move']]:[]),['delete','Delete']];return `<div class="tree-menu-dismiss" data-dismiss-tree-menu></div><div class="tree-context-menu" role="menu" aria-label="Collection actions" style="left:${x}px;top:${y}px">${actions.map(([action,label])=>`<button role="menuitem" data-tree-action="${action}" class="${action==='delete'?'danger':''}">${label}${action==='rename'?'<kbd>⌘E</kbd>':action==='duplicate'?'<kbd>⌘D</kbd>':''}</button>`).join('')}</div>`}
function openTreeMenu(row,x,y){try{sync()}catch(e){toast(e.message);return}treeSelection={kind:row.dataset.entityKind,collectionId:row.dataset.collectionId,id:row.dataset.entityId};treeMenu={...treeSelection,x:Math.max(8,Math.min(x,innerWidth-196)),y:Math.max(8,Math.min(y,innerHeight-294))};render();$('.tree-context-menu button')?.focus()}
function openEntityDialog(action,kind,collectionId=null,id=null,fromSave=false){if(!fromSave){try{sync()}catch(e){toast(e.message);return}}const {item}=entityRef(kind,collectionId,id);treeMenu=null;entityDialog={action,kind,collectionId,id,fromSave,name:action==='create'?(kind==='collection'?'New Collection':'New Folder'):item?.name||'',description:typeof item?.description==='string'?item.description:item?.description?.content||'',destination:collectionId+':',error:''};render();const input=$('#entityName');input?.focus();input?.select()}
function destinationOptions(d){const {c}=entityRef(d.kind,d.collectionId,d.id),excluded=d.kind==='folder'&&c?folderDescendants(c,d.id):new Set();return state.collections.flatMap(c=>[{value:c.id+':',label:c.name},...(c.folders||[]).filter(f=>c.id!==d.collectionId||!excluded.has(f.id)).map(f=>({value:c.id+':'+f.id,label:c.name+' / '+folderPath(c,f.id)}))]).map(({value,label})=>`<option value="${esc(value)}" ${value===d.destination?'selected':''}>${esc(label)}</option>`).join('')}
function entityDialogPanel(){const d=entityDialog,kind=d.kind==='collection'?'collection':d.kind==='folder'?'folder':'request',title=d.action==='create'?'Create '+kind:d.action==='delete'?'Delete '+kind:d.action==='move'?'Move '+kind:d.action==='rename'?'Rename '+kind:'Edit '+kind;let content='';if(d.action==='delete'){const {c,item}=entityRef(d.kind,d.collectionId,d.id);const folderIds=d.kind==='folder'&&c?folderDescendants(c,d.id):new Set();const count=d.kind==='collection'?c?.items.length:d.kind==='folder'?c?.items.filter(r=>folderIds.has(r.folderId)).length:0;content=`<p>Delete <strong data-no-translate>${esc(item?.name)}</strong>${count?` and its ${count} request${count===1?'':'s'}`:''}?</p><p class="entity-hint">You can undo the most recent deletion while the app is open.</p>`}else if(d.action==='move')content=`<label>Move to<select id="entityDestination">${destinationOptions(d)}</select></label>`;else content=`<label>Name<input id="entityName" value="${esc(d.name)}" autocomplete="off"/></label>${d.action==='edit'?`<label>Description<textarea id="entityDescription" rows="5">${esc(d.description)}</textarea></label>`:''}`;return `<div class="modal-backdrop entity-backdrop"><form class="entity-modal" role="dialog" aria-modal="true" aria-label="${title}"><header><strong>${title}</strong><button type="button" id="entityClose" aria-label="Close">${icon('close')}</button></header><div class="entity-fields">${content}<div id="entityError" role="alert">${esc(d.error)}</div></div><footer><button type="button" id="entityCancel">Cancel</button><button id="entityConfirm" class="${d.action==='delete'?'danger-primary':'entity-primary'}" type="submit">${d.action==='delete'?'Delete':d.action==='move'?'Move':d.action==='create'?'Create':'Save'}</button></footer></form></div>`}
let undoDeletion=null;
function showDeletionUndo(){document.querySelector('.deletion-notice')?.remove();const n=document.createElement('div');n.className='notice deletion-notice';n.innerHTML='<span>Deleted</span><button id="undoDeletion">Undo</button>';document.body.append(n);$('#undoDeletion').onclick=()=>{try{sync()}catch(e){toast(e.message);return}undoDeletion?.();undoDeletion=null;n.remove();persist();render()}}
function removeEntity(d){const {c,item}=entityRef(d.kind,d.collectionId,d.id);if(!c||!item)return;const beforeTabs=[...openTabs],beforeSelected=selectedTab,oldResponses={...tabResponses};let removedRequests=[],removedFolders=[];const index=state.collections.indexOf(c);if(d.kind==='collection'){removedRequests=[...c.items];removedFolders=[...(c.folders||[])];state.collections.splice(index,1)}else if(d.kind==='folder'){const ids=folderDescendants(c,item.id);removedFolders=c.folders.filter(f=>ids.has(f.id));removedRequests=c.items.filter(r=>ids.has(r.folderId));c.folders=c.folders.filter(f=>!ids.has(f.id));c.items=c.items.filter(r=>!ids.has(r.folderId))}else{removedRequests=[item];c.items=c.items.filter(r=>r.id!==item.id)}const removedIds=new Set(removedRequests.map(r=>r.id));openTabs=openTabs.filter(id=>!removedIds.has(id));for(const id of removedIds)delete tabResponses[id];if(removedIds.has(selectedTab)){const activeIndex=beforeTabs.indexOf(selectedTab);selectedTab=beforeTabs.slice(0,activeIndex).reverse().find(id=>openTabs.includes(id))||openTabs[0]||'';if(selectedTab.startsWith('mock:'))selectedMockId=selectedTab.slice(5);response=tabResponses[selectedTab]||null}treeSelection=null;if(saveTarget?.collectionId===c.id)saveTarget=null;undoDeletion=()=>{if(d.kind==='collection'){if(!state.collections.some(x=>x.id===c.id))state.collections.splice(Math.min(index,state.collections.length),0,c)}else{const target=state.collections.find(x=>x.id===c.id);if(!target){toast('Restore the collection first');return}target.items.push(...removedRequests.filter(r=>!target.items.some(x=>x.id===r.id)));target.folders.push(...removedFolders.filter(f=>!target.folders.some(x=>x.id===f.id)))}openTabs=[...new Set([...openTabs,...beforeTabs.filter(id=>removedIds.has(id))])];if(removedIds.has(beforeSelected))selectedTab=beforeSelected;tabResponses={...tabResponses,...Object.fromEntries(removedRequests.filter(r=>oldResponses[r.id]).map(r=>[r.id,oldResponses[r.id]]))};response=tabResponses[selectedTab]||null};}
function duplicateEntity(d){const {c,item}=entityRef(d.kind,d.collectionId,d.id);if(!c||!item)return;const clone=x=>JSON.parse(JSON.stringify(x));if(d.kind==='request'){const r={...clone(item),id:uniqueId('r'),name:item.name+' Copy'};c.items.push(r);setRequestBaseline(r);openTabs.push(r.id);selectedTab=r.id;response=null;revealFolder(c,r.folderId)}else{const folderIds=d.kind==='collection'?new Set(c.folders.map(f=>f.id)):folderDescendants(c,item.id),idMap=new Map([...folderIds].map(id=>[id,uniqueId('f')]));const folders=c.folders.filter(f=>folderIds.has(f.id)).map(f=>({...clone(f),id:idMap.get(f.id),parentId:idMap.get(f.parentId)||f.parentId||null}));const items=c.items.filter(r=>d.kind==='collection'||folderIds.has(r.folderId)).map(r=>({...clone(r),id:uniqueId('r'),folderId:idMap.get(r.folderId)||null}));if(d.kind==='collection'){const copy={...clone(c),id:uniqueId('c'),name:c.name+' Copy',folders,items};state.collections.push(copy);treeSelection={kind:'collection',collectionId:copy.id,id:copy.id}}else{folders.find(f=>f.id===idMap.get(item.id)).name=item.name+' Copy';c.folders.push(...folders);c.items.push(...items);revealFolder(c,item.parentId)}}for(const r of reqs())if(!requestBaselines.has(r.id))setRequestBaseline(r);sidebarFilter='';persist();render()}
function moveEntity(d){const {c,item}=entityRef(d.kind,d.collectionId,d.id);const [targetId,folderId='']=d.destination.split(':');const target=state.collections.find(c=>c.id===targetId);if(!c||!item||!target)throw Error('Select a collection');if(folderId&&!target.folders.some(f=>f.id===folderId))throw Error('Select a valid folder');if(d.kind==='request'){if(c!==target){c.items=c.items.filter(r=>r.id!==item.id);target.items.push(item)}item.folderId=folderId||null;const baseline=requestBaselines.get(item.id);if(baseline)baseline.folderId=item.folderId}else{const ids=folderDescendants(c,item.id);if(c===target&&ids.has(folderId))throw Error('A folder cannot be moved inside itself');if(c!==target){target.folders.push(...c.folders.filter(f=>ids.has(f.id)));target.items.push(...c.items.filter(r=>ids.has(r.folderId)));c.folders=c.folders.filter(f=>!ids.has(f.id));c.items=c.items.filter(r=>!ids.has(r.folderId))}item.parentId=folderId||null}collapsedCollections.delete(target.id);revealFolder(target,folderId);treeSelection={kind:d.kind,id:item.id,collectionId:target.id};sidebarFilter=''}
function confirmEntityDialog(){const d=entityDialog;if(!d)return;try{const {c,item}=entityRef(d.kind,d.collectionId,d.id);if(d.action==='delete')removeEntity(d);else if(d.action==='move')moveEntity(d);else{const name=$('#entityName').value.trim();if(!name)throw Error('Name is required');if(d.action==='create'){if(d.kind==='collection'){const created={id:uniqueId('c'),name,items:[],folders:[]};state.collections.push(created);treeSelection={kind:'collection',collectionId:created.id,id:created.id};if(d.fromSave)saveTarget={collectionId:created.id,folderId:null}}else{if(!c)throw Error('Collection no longer exists');const folder={id:uniqueId('f'),name,parentId:c.folders.some(f=>f.id===d.id)?d.id:null};c.folders.push(folder);collapsedCollections.delete(c.id);revealFolder(c,folder.parentId);treeSelection={kind:'folder',id:folder.id,collectionId:c.id};if(d.fromSave)saveTarget={collectionId:c.id,folderId:folder.id}}sidebarFilter=''}else{if(!item)throw Error('Item no longer exists');item.name=name;if(d.action==='edit')item.description=$('#entityDescription').value;if(d.kind==='request'){const baseline=requestBaselines.get(item.id);if(baseline){baseline.name=item.name;if(d.action==='edit')baseline.description=item.description}}}}entityDialog=null;persist();render();if(d.action==='delete')showDeletionUndo()}catch(e){d.error=e.message;$('#entityError').textContent=e.message}}
function bindCollectionActions(){
 const collectionsToggle=$('#toggleCollections');if(collectionsToggle)collectionsToggle.onclick=()=>{sync();collectionsExpanded=!collectionsExpanded;render()};
 document.querySelectorAll('.tree-row').forEach(row=>{row.oncontextmenu=e=>{e.preventDefault();openTreeMenu(row,e.clientX,e.clientY)};row.querySelector('[data-tree-menu]').onclick=e=>{e.stopPropagation();const rect=e.currentTarget.getBoundingClientRect();openTreeMenu(row,rect.right,rect.bottom)}});
 document.querySelectorAll('[data-toggle-folder]').forEach(button=>button.onclick=()=>{sync();const row=button.closest('.tree-row'),id=button.dataset.toggleFolder;treeSelection={kind:'folder',id,collectionId:row.dataset.collectionId};expandedFolders.has(id)?expandedFolders.delete(id):expandedFolders.add(id);render()});
 document.querySelectorAll('[data-tree-action]').forEach(button=>button.onclick=()=>{const d=treeMenu,action=button.dataset.treeAction;treeMenu=null;if(action==='add-request'){newRequest(d.collectionId,d.kind==='folder'?d.id:null);return}if(action==='add-folder'){openEntityDialog('create','folder',d.collectionId,d.kind==='folder'?d.id:null);return}if(action==='duplicate'){duplicateEntity(d);return}openEntityDialog(action,d.kind,d.collectionId,d.id)});
 $('[data-dismiss-tree-menu]')?.addEventListener('click',()=>{treeMenu=null;render()});$('#emptyNewRequest')?.addEventListener('click',()=>newRequest());
 if(entityDialog){$('.entity-modal').onsubmit=e=>{e.preventDefault();confirmEntityDialog()};const close=()=>{entityDialog=null;render()};$('#entityClose').onclick=$('#entityCancel').onclick=close;$('#entityDestination')?.addEventListener('change',e=>{entityDialog.destination=e.target.value});$('#entityName')?.addEventListener('input',e=>{entityDialog.name=e.target.value})}
}
document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(entityDialog){entityDialog=null;render();return}if(treeMenu){treeMenu=null;render();return}}if(e.target?.closest?.('input,textarea,select,[contenteditable=true]')||entityDialog||showImport||showSave||showEnv||closePromptTarget||view!=='collections'||!treeSelection)return;const d=treeSelection;if((e.metaKey||e.ctrlKey)&&['e','d'].includes(e.key.toLowerCase())){e.preventDefault();sync();if(e.key.toLowerCase()==='e')openEntityDialog('rename',d.kind,d.collectionId,d.id);else duplicateEntity(d)}else if(e.key==='Backspace'||e.key==='Delete'){e.preventDefault();openEntityDialog('delete',d.kind,d.collectionId,d.id)}});

function collectionItems(c,open){if(!open)return '';const query=sidebarFilter.trim().toLowerCase(),all=c.name.toLowerCase().includes(query);const folders=c.folders||[];const folderMatches=(f,seen=new Set())=>{if(seen.has(f.id))return false;const next=new Set(seen).add(f.id);return f.name.toLowerCase().includes(query)||c.items.some(r=>r.folderId===f.id&&r.name.toLowerCase().includes(query))||folders.some(child=>child.parentId===f.id&&folderMatches(child,next))};
 const renderBranch=(folderId=null,depth=0,inherited=all,seen=new Set())=>{const rows=[];for(const f of folders.filter(f=>(f.parentId||null)===folderId)){if(seen.has(f.id)||(!inherited&&!folderMatches(f)))continue;const expanded=query?true:expandedFolders.has(f.id);rows.push(treeRow('folder',c,f,`<button class="collection-folder" data-toggle-folder="${esc(f.id)}" aria-expanded="${expanded}"><span class="chevron">${expanded?'⌄':'›'}</span>${icon('folder')}<span class="tree-label">${esc(f.name)}</span></button>`,depth));if(expanded)rows.push(renderBranch(f.id,depth+1,inherited||f.name.toLowerCase().includes(query),new Set(seen).add(f.id)))}for(const r of c.items.filter(r=>(r.folderId||null)===folderId)){if(!inherited&&!r.name.toLowerCase().includes(query))continue;rows.push(treeRow('request',c,r,`<button class="tree-request ${r.id===selectedTab?'selected':''}" data-open-request="${esc(r.id)}"><span class="tree-method ${esc(r.method.toLowerCase())}">${esc(r.method)}</span><span class="tree-label">${esc(r.name)}</span></button>`,depth))}return rows.join('')};return renderBranch()}
function collectionTree(){const query=sidebarFilter.trim().toLowerCase();return state.collections.map(c=>{const matches=!query||c.name.toLowerCase().includes(query)||c.items.some(r=>r.name.toLowerCase().includes(query))||(c.folders||[]).some(f=>f.name.toLowerCase().includes(query));if(!matches)return '';const open=query?true:!collapsedCollections.has(c.id);return `<div class="collection">${treeRow('collection',c,c,`<button class="collection-head" data-toggle-collection="${esc(c.id)}" aria-expanded="${open}"><span class="chevron">${open?'⌄':'›'}</span>${icon('folder')}<strong>${esc(c.name)}</strong></button>`)}${collectionItems(c,open)}</div>`}).join('')||`<div class="side-empty">${query?'No results found':'No collections yet'}</div>`}
function sidebar(){state.mockServers=state.mockServers||[];
 const envOpen=expandedSections.has('Environments');
 const sections=state.environments.length?`<div class="side-sections"><section><button class="section-toggle" data-section="Environments" aria-expanded="${envOpen}"><span class="chevron">${envOpen?'⌄':'›'}</span><span>ENVIRONMENTS</span></button>${envOpen?`<div class="section-items">${state.environments.map(e=>`<button data-edit-env="${esc(e.id)}">${icon('environments')}${esc(e.name)}</button>`).join('')}<button id="openEnv">＋ New environment</button></div>`:''}</section></div>`:'';
 if(view==='history'){const filtered=state.history.filter(h=>!sidebarFilter||`${h.name||''} ${h.url||''} ${h.method||''}`.toLowerCase().includes(sidebarFilter.toLowerCase()));return `<div class="sidebar-title"><span>HISTORY</span><button id="clearHistory">Clear</button></div><div class="history-list">${filtered.length?filtered.map(h=>`<button data-history="${h.id}"><span class="tree-method ${h.method.toLowerCase()}">${h.method}</span><span>${esc(h.name||h.url)}</span><small>${h.at?new Date(h.at).toLocaleString():''}</small></button>`).join(''):'<div class="side-empty">No requests in history</div>'}</div>`}
 if(view==='services')return mockPanel();
 if(view==='git')return gitSidebar();
 if(view==='environments')return `<div class="sidebar-title">ENVIRONMENTS</div><div class="collection-tree">${state.environments.map(e=>`<button class="tree-request" data-edit-env="${e.id}">${icon('environments')}${esc(e.name)}</button>`).join('')}<button class="text-button" id="openEnv">＋ New environment</button></div>${sections}`;
 return `<div class="sidebar-title"><button id="toggleCollections" class="collection-section-toggle" aria-label="Collections" aria-expanded="${collectionsExpanded}" aria-controls="collectionsTree"><span class="chevron">${collectionsExpanded?'⌄':'›'}</span><span>COLLECTIONS</span></button><button id="addCollection" title="New collection" aria-label="New collection">${icon('add')}</button></div>${collectionsExpanded?`<div id="collectionsTree" class="collection-tree">${collectionTree()}</div>`:''}${sections}`
}
const rawFormats={Text:'text/plain',JavaScript:'application/javascript',JSON:'application/json',HTML:'text/html',XML:'application/xml'};
function environmentValues(r=current(),environment=activeEnv()){const c=state.collections.find(c=>c.items.some(x=>x.id===r?.id));const rows=values=>Object.fromEntries((Array.isArray(values)?values:[]).filter(v=>v.enabled!==false).map(v=>[v.key,v.value]));let values=rows(c?.variables);const chain=[],seen=new Set();let id=r?.folderId;while(id&&!seen.has(id)){seen.add(id);const f=c?.folders.find(x=>x.id===id);if(!f)break;chain.unshift(f);id=f.parentId}for(const f of chain)Object.assign(values,rows(f.variables));return {...values,...environment?.values,...environment?.currentValues,...rows(r?.variables)}}
function highlighted(value,json=false){const env=environmentValues();const token=/\{\{[^{}]*\}\}|"(?:\\.|[^"\\])*"|\b(?:true|false|null)\b|-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/g;let result='',last=0;for(const match of value.matchAll(token)){result+=esc(value.slice(last,match.index));const text=match[0];if(text.startsWith('{{')){const key=text.slice(2,-2).trim(),known=Object.hasOwn(env,key);result+=`<mark class="variable-token ${known?'resolved':'unresolved'}" title="${esc(known?key+': '+env[key]:'Unresolved variable: '+key)}">${esc(text)}</mark>`}else if(json){const cls=text.startsWith('"')?(/^\s*:/.test(value.slice(match.index+text.length))?'json-key':'json-string'):/^(true|false|null)$/.test(text)?'json-literal':'json-number';result+=`<span class="${cls}">${highlightVariables(text)}</span>`}else result+=highlightVariables(text);last=match.index+text.length}return result+esc(value.slice(last))}
function highlightVariables(text){const env=environmentValues();return text.split(/(\{\{[^{}]*\}\})/g).map(part=>{if(!part.startsWith('{{'))return esc(part);const key=part.slice(2,-2).trim(),known=Object.hasOwn(env,key);return `<mark class="variable-token ${known?'resolved':'unresolved'}" title="${esc(known?key+': '+env[key]:'Unresolved variable: '+key)}">${esc(part)}</mark>`}).join('')}
function rawEditor(value,id='body'){const json=id==='graphqlVariables'||(id==='body'&&(current().rawFormat||'JSON')==='JSON');return `<div class="raw-editor"><div class="code-gutter" aria-hidden="true">${value.split('\n').map((_,i)=>i+1).join('\n')}</div><div class="code-surface"><pre class="code-highlight" aria-hidden="true">${highlighted(value,json)}\n</pre><textarea id="${id}" data-json="${json}" aria-label="${id==='body'?'Request body':id}" spellcheck="false">${esc(value)}</textarea></div></div>`}
function closeHeaderSuggest(){document.querySelector('.header-suggestions')?.remove();activeHeaderSuggest=null}
function chooseHeaderSuggestion(value){const input=activeHeaderSuggest?.input;if(!input)return;input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));closeHeaderSuggest();input.focus()}
function renderHeaderSuggest(input){if(appSettings.general.variableAutocomplete===false){closeHeaderSuggest();return}const query=input.value.trim().toLowerCase(),matches=headerKeySuggestions.filter(value=>!query||value.toLowerCase().includes(query)).slice(0,80);if(!matches.length){closeHeaderSuggest();return}let menu=document.querySelector('.header-suggestions');if(!menu){menu=document.createElement('div');menu.className='header-suggestions';menu.setAttribute('role','listbox');document.body.append(menu)}const rect=input.getBoundingClientRect();menu.style.left=`${rect.left}px`;menu.style.top=`${rect.bottom+2}px`;menu.style.width=`${Math.max(rect.width,260)}px`;menu.innerHTML=matches.map((value,index)=>`<button type="button" role="option" data-header-suggestion="${esc(value)}" aria-selected="${index===0}">${esc(value)}</button>`).join('');activeHeaderSuggest={input,index:0,items:matches};menu.querySelectorAll('[data-header-suggestion]').forEach(button=>button.onmousedown=event=>{event.preventDefault();chooseHeaderSuggestion(button.dataset.headerSuggestion)})}
function moveHeaderSuggest(delta){const state=activeHeaderSuggest,menu=document.querySelector('.header-suggestions');if(!state||!menu)return;state.index=(state.index+delta+state.items.length)%state.items.length;menu.querySelectorAll('[role=option]').forEach((button,index)=>button.setAttribute('aria-selected',String(index===state.index)));menu.querySelector('[aria-selected="true"]')?.scrollIntoView?.({block:'nearest'})}
function bindHeaderSuggestions(){document.querySelectorAll('[data-header-key]').forEach(input=>{const persistInput=input.oninput;input.onfocus=()=>renderHeaderSuggest(input);input.oninput=event=>{persistInput?.call(input,event);renderHeaderSuggest(input)};input.onkeydown=event=>{if(!document.querySelector('.header-suggestions')){if(event.key==='ArrowDown')renderHeaderSuggest(input);return}if(event.key==='ArrowDown'){event.preventDefault();moveHeaderSuggest(1)}else if(event.key==='ArrowUp'){event.preventDefault();moveHeaderSuggest(-1)}else if(event.key==='Enter'){event.preventDefault();const state=activeHeaderSuggest;if(state)chooseHeaderSuggestion(state.items[state.index])}else if(event.key==='Escape'){event.preventDefault();closeHeaderSuggest()}};input.onblur=()=>setTimeout(()=>{if(!document.querySelector('.header-suggestions:hover'))closeHeaderSuggest()},120)})}
function bindHighlights(){document.querySelectorAll('input[list="variableSuggestions"]').forEach(input=>{if(input.closest('.variable-input'))return;const wrapper=document.createElement('div');wrapper.className='variable-input'+(input.id==='url'?' url-variable':'');input.before(wrapper);const overlay=document.createElement('div');overlay.className='input-highlight';overlay.setAttribute('aria-hidden','true');wrapper.append(overlay,input);const refresh=()=>{overlay.innerHTML=highlightVariables(input.value);overlay.scrollLeft=input.scrollLeft;input.classList.toggle('has-variables',input.value.includes('{{'))};input.addEventListener('input',refresh);input.addEventListener('scroll',refresh);refresh()});document.querySelectorAll('.raw-editor textarea[data-json]').forEach(t=>{const surface=t.parentElement,gutter=surface.previousElementSibling,overlay=surface.querySelector('.code-highlight');const refresh=()=>{gutter.textContent=t.value.split('\n').map((_,i)=>i+1).join('\n');overlay.innerHTML=highlighted(t.value,t.dataset.json==='true')+'\n';overlay.scrollTop=t.scrollTop;overlay.scrollLeft=t.scrollLeft;gutter.scrollTop=t.scrollTop};t.addEventListener('input',refresh);t.addEventListener('scroll',refresh);t.addEventListener('keydown',e=>editorPreferences(t,e),true);t.addEventListener('paste',e=>editorPreferences(t,e));t.addEventListener('keydown',e=>{if(e.key==='Tab'){e.preventDefault();t.setRangeText('  ',t.selectionStart,t.selectionEnd,'end');t.dispatchEvent(new Event('input'))}if((e.metaKey||e.ctrlKey)&&e.shiftKey&&e.key.toLowerCase()==='b'){e.preventDefault();beautifyBody()}});refresh()})}

function beautifyBody(){const t=$('#body');if(!t)return;const error=$('#bodyError');try{const formatted=JSON.stringify(JSON.parse(t.value),null,appSettings.general.editorIndentation==='tabs'?'\t':appSettings.general.editorTabSize||2);t.value=formatted;t.dispatchEvent(new Event('input'));current().body=formatted;persist();error.textContent='';t.removeAttribute('aria-invalid')}catch(e){error.textContent='Invalid JSON: '+e.message;t.setAttribute('aria-invalid','true')}}
function responsePanel(){let body=response.body;if(responseView==='Pretty'||appSettings.general.responseFormat==='json'&&responseView!=='Raw'){try{body=JSON.stringify(JSON.parse(body),null,2)}catch{}}if(responseView==='Headers')return `<div class="response-headers">${Object.entries(response.headers||{}).map(([k,v])=>`<div><strong>${esc(k)}</strong><span>${esc(v)}</span></div>`).join('')}</div>`+responseTabs();return responseTabs()+`<pre class="response-code">${esc(body)}</pre>`}
function responseTabs(){return `<div class="response-tabs">${['Pretty','Raw','Headers'].map(t=>`<button data-response-view="${t}" class="${responseView===t?'active':''}">${t}</button>`).join('')}<span></span><span>${response.size||new TextEncoder().encode(response.body).length} B</span></div>`}
function builder(r){
 if(activeTab==='Docs')return `<div class="docs-editor"><label>Description</label><textarea id="description" placeholder="Add a description for this request">${esc(r.description||'')}</textarea></div>`;
  if(activeTab==='Params')return tableEditor('param',r.params||{},'Query parameters are added to the URL only when their checkbox is enabled.');
  if(activeTab==='Headers')return tableEditor('header',r.headers||{},'Headers support common-name suggestions and {{environment variables}}.');
  if(activeTab==='Body'){const mode=r.bodyType||'raw';return `<div class="body-layout"><div class="body-options" role="radiogroup" aria-label="Body type">${[['none','none'],['form-data','form-data'],['urlencoded','x-www-form-urlencoded'],['raw','raw'],['binary','binary'],['graphql','GraphQL']].map(([v,l])=>`<label><input type="radio" name="bodyType" value="${v}" ${mode===v?'checked':''}/> ${l}</label>`).join('')}${mode==='raw'?`<select id="rawFormat" aria-label="Raw body format">${Object.keys(rawFormats).map(f=>`<option ${f===(r.rawFormat||'JSON')?'selected':''}>${f}</option>`).join('')}</select>${(r.rawFormat||'JSON')==='JSON'?'<button id="beautifyBody" title="Beautify JSON (⌘⇧B)">Beautify</button>':''}`:''}</div><div id="bodyError" role="alert" class="body-error"></div>${mode==='raw'?rawEditor(r.body||''):mode==='none'?'<div class="body-empty">This request does not have a body</div>':mode==='graphql'?`<div class="graphql-editor"><div class="editor-label">QUERY</div>${rawEditor(r.graphqlQuery||'','graphqlQuery')}<div class="editor-label">GRAPHQL VARIABLES</div>${rawEditor(r.graphqlVariables||'','graphqlVariables')}</div>`:mode==='binary'?`<div class="binary-panel"><label class="file-picker">Select file<input id="binaryFile" type="file"/></label><span ${r.binaryName?'data-no-translate':''}>${esc(r.binaryName||'No file selected')}</span><button id="binaryFromWorkingDirectory" class="text-button">Choose from working directory…</button></div>`:tableEditor('bodyfield',r.bodyFields||{},'')}</div>`}
  if(activeTab==='Authorization'){const auth=r.auth||{type:'No Auth'};const fields=auth.type==='Bearer Token'?['token']:auth.type==='Basic Auth'?['username','password']:auth.type==='API Key'?['key','value']:[];return `<div class="auth-layout"><div class="auth-type"><label>Auth type</label><select id="authType">${['No Auth','Bearer Token','Basic Auth','API Key'].map(t=>`<option ${t===auth.type?'selected':''}>${t}</option>`).join('')}</select></div><div class="auth-fields">${fields.length?fields.map(k=>`<label>${k}<input data-auth="${k}" type="${k==='password'?'password':'text'}" list="variableSuggestions" value="${esc(auth[k]||'')}"/></label>`).join('')+(auth.type==='API Key'?`<label>Add to<select data-auth="location"><option value="header">Header</option><option value="query" ${auth.location==='query'?'selected':''}>Query Params</option></select></label>`:''):'<strong>No Auth</strong><p>This request does not use any authorization.</p>'}</div></div>`}
  if(activeTab==='Scripts')return `<div class="script-preserved"><p>Imported scripts are preserved as text. Script execution is not available.</p><textarea readonly aria-label="Preserved scripts">${esc([r.preRequestScript,r.tests].filter(Boolean).join('\n\n'))}</textarea></div>`;
  return `<div class="settings-grid">${[['followRedirects','Automatically follow redirects'],['verifySsl','Enable SSL certificate verification']].map(([key,label])=>`<label>${label}<input data-setting="${key}" type="checkbox" ${effectiveRequestSettings(r)[key]?'checked':''}/></label>`).join('')}<label>Request timeout (ms)<input id="requestTimeout" type="number" min="0" value="${effectiveRequestSettings(r).timeout}"/></label></div>`
}
function mapRows(data){return Array.isArray(data)?data:Object.entries(data||{}).map(([key,v])=>({key,value:typeof v==='object'?v.value:v,enabled:typeof v==='object'?v.enabled!==false:true,description:typeof v==='object'?v.description||'':''}))}
function tableEditor(kind,data,note){const rows=mapRows(data);const bulk=bulkEditors.has(kind);return `<div class="key-table"><div class="table-toolbar"><span>${kind==='param'?'Query Params':kind==='header'?'Headers':'Body fields'}</span><button data-bulk="${kind}">${bulk?'Key-Value Edit':'Bulk Edit'}</button></div>${bulk?`<textarea class="bulk-editor" data-bulk-input="${kind}" aria-label="Bulk ${kind}">${esc(rows.map(r=>(r.enabled?'':'//')+r.key+':'+r.value).join('\n'))}</textarea>`:`<div class="key-head"><span></span><span>KEY</span><span>VALUE</span><span>DESCRIPTION</span></div>${[...rows,{key:'',value:'',enabled:false,description:''}].map((r,i)=>keyRow(kind,i,r.key,r.value,r.enabled,r.description)).join('')}<button class="text-button" data-add-row="${kind}">＋ Add ${kind==='header'?'header':kind==='param'?'parameter':'field'}</button>`}</div>`}
function keyRow(kind,i,k,v,on=true,description=''){return `<div class="key-row"><input type="checkbox" ${on?'checked':''} data-${kind}-enabled="${i}"/><input value="${esc(k)}" ${kind==='header'?'autocomplete=\"off\"':'list=\"variableSuggestions\"'} placeholder="Key" data-${kind}-key="${i}"/><input value="${esc(v)}" list="variableSuggestions" placeholder="Value" data-${kind}-value="${i}"/><input placeholder="Description" value="${esc(description)}" data-${kind}-description="${i}"/><button data-delete-${kind}="${i}">×</button></div>`}
function paramsFromUrl(r,{preserveDisabled=false,clearMissing=false}={}){try{const query=r.url.split('?')[1]?.split('#')[0];if(query===undefined&&!clearMissing)return;const previous=mapRows(r.params),parsed=Array.from(new URLSearchParams(query||''),([key,value])=>({key,value,enabled:true})),used=new Set();r.params=parsed.map(row=>{let index=previous.findIndex((old,i)=>!used.has(i)&&old.enabled!==false&&old.key===row.key&&String(old.value)===row.value);if(index<0)index=previous.findIndex((old,i)=>!used.has(i)&&old.enabled!==false&&old.key===row.key);if(index>=0)used.add(index);return {...(previous[index]||{}),...row,description:previous[index]?.description||''}});if(preserveDisabled)r.params.push(...previous.filter(row=>row.enabled===false))}catch{}}
function parseBulkRows(text,previous){const used=new Set();return text.split('\n').filter(line=>line.trim()).map(line=>{const enabled=!line.startsWith('//');if(!enabled)line=line.slice(2);const split=line.indexOf(':'),key=split<0?line:line.slice(0,split),value=split<0?'':line.slice(split+1);let index=previous.findIndex((old,i)=>!used.has(i)&&old.key===key&&String(old.value??'')===value);if(index<0)index=previous.findIndex((old,i)=>!used.has(i)&&old.key===key);if(index>=0)used.add(index);return {...(previous[index]||{}),key,value,enabled,description:previous[index]?.description||''}})}
function updateQuery(r){const query=new URLSearchParams(mapRows(r.params).filter(x=>x.enabled&&x.key).map(x=>[x.key,x.value])).toString();const [beforeHash,hash]=r.url.split('#');r.url=beforeHash.split('?')[0]+(query?'?'+query:'')+(hash?'#'+hash:'')}
function environmentDraft(environment){
 const e=environment?cloneRequest(environment):{id:uniqueId('e'),name:'New Environment',values:{},currentValues:{}};
 e._editorRows=Object.entries(e.values||{}).map(([key,value])=>({key,value:String(value??''),current:String(e.currentValues?.[key]??value??''),currentExplicit:Object.hasOwn(e.currentValues||{},key)}));
 e._editorRows.push({key:'',value:'',current:''});return e;
}
function openEnvironmentEditor(id=null,{create=false}={}){
 sync();envSession=new Map();envError='';envDeletePrompt=false;
 const e=create?null:state.environments.find(e=>e.id===(id||state.activeEnvironmentId))||state.environments[0];
 envDraft=environmentDraft(e);envSession.set(envDraft.id,envDraft);showEnv=true;render();$('#envName')?.focus();
}
function captureEnvDraft(){
 if(!envDraft||!$('#envName')||envSaving||$('.env-modal')?.dataset.environmentId!==envDraft.id)return;
 envDraft.name=$('#envName').value;
 envDraft._editorRows=Array.from(document.querySelectorAll('[data-env-key]'),(input,i)=>{const previous=envDraft._editorRows[i]||{},value=$(`[data-env-value="${i}"]`)?.value??'',field=$(`[data-env-current="${i}"]`),explicit=previous.currentExplicit||field?.dataset.explicit==='true'||field?.value!==(previous.current??'');const current=explicit?(field?.value??''):value;if(field)field.value=current;return {key:input.value,value,current,currentExplicit:explicit}});
 envSession.set(envDraft.id,envDraft);
}
function collectEnv(draft=envDraft){
 if(draft===envDraft)captureEnvDraft();
 const name=draft.name.trim();if(!name)throw Error('Enter an environment name.');
 const rows=draft._editorRows.filter(row=>row.key.trim()),keys=rows.map(row=>row.key.trim());
 if(new Set(keys).size!==keys.length)throw Error('Variable names must be unique within an environment.');
 const e={...draft,name,values:Object.fromEntries(rows.map(row=>[row.key.trim(),row.value])),currentValues:Object.fromEntries(rows.map(row=>[row.key.trim(),row.current]))};delete e._editorRows;return e;
}
function envDialog(){
 const e=envDraft,entries=[...new Map([...state.environments,...envSession.values()].map(x=>[x.id,x])).values()];
 return `<div class="modal-backdrop env-backdrop"><div class="env-modal" data-environment-id="${esc(e.id)}" role="dialog" aria-modal="true" aria-label="Environments" aria-busy="${envSaving}"><header><strong>Environments</strong><button id="closeEnv" aria-label="Close environments">${icon('close')}</button></header><div class="env-list">${entries.map(x=>`<button data-pick-env="${esc(x.id)}" class="${x.id===e.id?'selected':''}" aria-pressed="${x.id===e.id}">${icon('environments')}<span>${esc(x.name||'Untitled environment')}</span></button>`).join('')}<button id="newEnv">${icon('add')}<span>New environment</span></button></div><div class="env-editor"><label>Name <input id="envName" value="${esc(e.name)}" autocomplete="off"/></label><div class="env-head"><span>VARIABLE</span><span>INITIAL VALUE</span><span>CURRENT VALUE</span><span></span></div><div class="env-rows">${e._editorRows.map((row,i)=>`<div class="env-row"><input value="${esc(row.key)}" placeholder="variable" aria-label="Variable ${i+1}" data-env-key="${i}"/><input value="${esc(row.value)}" placeholder="value" aria-label="Initial value ${i+1}" data-env-value="${i}"/><input value="${esc(row.current)}" placeholder="current value" aria-label="Current value ${i+1}" data-env-current="${i}"/><button data-remove-env-row="${i}" title="Remove variable" aria-label="Remove variable ${i+1}">${icon('close')}</button></div>`).join('')}</div><button class="text-button" id="addEnvVar">${icon('add')} Add variable</button><p class="save-error" id="envError" role="alert">${esc(envError)}</p><footer>${envDeletePrompt?'<span class="env-delete-label">Delete this environment?</span><button id="cancelEnvDelete">Cancel</button><button id="confirmEnvDelete" class="env-danger">Delete</button>':`<button id="deleteEnv" ${state.environments.some(x=>x.id===e.id)?'':'disabled'}>Delete</button><span></span><button id="cancelEnv">Cancel</button><button class="env-save" id="saveEnv">${envSession.size>1?'Save all':'Save'}</button>`}</footer></div></div></div>`;
}

function activeEnv(){return state.environments.find(e=>e.id===state.activeEnvironmentId)}
function collectionName(r){return state.collections.find(c=>c.items.some(x=>x.id===r.id))?.name||'History'}
function sync({urlInput=false,commitQuery=false,deferSave=false}={}){
 if(serviceTabInfo(selectedTab)){collectService();return}
 if(selectedTab===mockCreateTabId){collectMockDraft();return}
 if(selectedTab.startsWith('mock:')){collectMock();persist();return}
 const editor=$('#requestCanvas');const r=reqs().find(x=>x.id===selectedTab);if(!r||!$('#requestName'))return;
 r.name=$('#requestName')?.value||r.name;
 if($('#description'))r.description=$('#description').value;
 if($('#authType')){r.auth={...r.auth,type:$('#authType').value};editor.querySelectorAll('[data-auth]').forEach(e=>r.auth[e.dataset.auth]=e.value)}
 if($('#requestTimeout')){const effective=effectiveRequestSettings(r),timeout=Math.max(0,Number($('#requestTimeout').value)||0);if(timeout!==effective.timeout)r.settings={...r.settings,timeout};editor.querySelectorAll('[data-setting]').forEach(e=>{if(e.checked!==effective[e.dataset.setting])r.settings={...r.settings,[e.dataset.setting]:e.checked}})}
 r.method=$('#method')?.value||r.method;
 const urlValue=$('#url')?.value??r.url,urlChanged=urlValue!==r.url;
 if(urlChanged){r.url=urlValue;paramsFromUrl(r,{preserveDisabled:true,clearMissing:!commitQuery})}
 if($('#body'))r.body=$('#body').value;
 if($('#tests'))r.tests=$('#tests').value;
 for(const key of ['graphqlQuery','graphqlVariables'])if($('#'+key))r[key]=$('#'+key).value;
 for(const kind of ['param','header','bodyfield']){
  const fields=editor.querySelectorAll(`[data-${kind}-key]`),bulk=editor.querySelector(`[data-bulk-input="${kind}"]`);
  if((kind==='param'&&urlChanged)||(!fields.length&&!bulk))continue;
  const target=kind==='param'?'params':kind==='header'?'headers':'bodyFields',previous=mapRows(r[target]);
  const out=bulk?parseBulkRows(bulk.value,previous):Array.from(fields,(el,i)=>({...previous[i],key:el.value,value:editor.querySelector(`[data-${kind}-value="${i}"]`)?.value||'',enabled:editor.querySelector(`[data-${kind}-enabled="${i}"]`)?.checked??false,description:editor.querySelector(`[data-${kind}-description="${i}"]`)?.value||''})).filter(x=>x.key.trim()||x.value.trim()||x.description.trim());
  r[target]=out;
  if(kind==='param'){updateQuery(r);if($('#url')){$('#url').value=r.url;$('#url').dispatchEvent(new Event('scroll'))}}
 }
 if(urlChanged&&activeTab==='Params'){const table=$('.builder-body');if(table){table.innerHTML=builder(r);bind()}}
 persist({defer:deferSave});
}

function openRequest(id){treeMenu=null;const owner=state.collections.find(c=>c.items.some(r=>r.id===id));if(owner)treeSelection={kind:'request',collectionId:owner.id,id};try{sync()}catch(e){toast(e.message);return}if(!openTabs.includes(id))openTabs.push(id);selectedTab=id;response=tabResponses[id]||null;persist();render()}
function refreshRequestNameLabels(id=selectedTab){
 const request=reqs().find(r=>r.id===id);if(!request)return;
 document.querySelectorAll('[data-select-tab]').forEach(tab=>{if(tab.dataset.selectTab!==id)return;tab.title=request.name;const title=tab.querySelector('.tab-title');if(title)title.textContent=request.name;tab.querySelector('[data-close-tab]')?.setAttribute('aria-label',`Close ${request.name}`)});
 document.querySelectorAll('[data-open-request]').forEach(button=>{if(button.dataset.openRequest===id){const label=button.querySelector('.tree-label');if(label)label.textContent=request.name}});
 refreshDirtyTabs();
}
function bindRequestName(){
 const input=$('#requestName');if(!input)return;
 const resize=()=>{input.style.setProperty('--request-name-width',`${Math.max(12,input.value.length+2)}ch`)};
 const start=()=>{if(input.dataset.editing==='true')return;input.dataset.originalName=input.value;input.dataset.editing='true';input.readOnly=false;input.classList.add('is-editing');input.select()};
 const finish=cancel=>{if(input.dataset.editing!=='true')return;const original=input.dataset.originalName||reqs().find(r=>r.id===selectedTab)?.name||'Untitled Request';input.value=cancel?original:(input.value.trim()||original);delete input.dataset.editing;delete input.dataset.originalName;input.readOnly=true;input.classList.remove('is-editing');resize();sync({deferSave:true});refreshRequestNameLabels()};
 input.onfocus=start;input.onclick=start;
 input.oninput=event=>{event.stopPropagation();resize();if(input.dataset.editing!=='true'){sync({deferSave:true});refreshRequestNameLabels()}};
 input.onblur=()=>finish(false);
 input.onkeydown=event=>{if(event.isComposing)return;if(event.key==='Enter'||event.key==='Escape'){event.preventDefault();event.stopPropagation();finish(event.key==='Escape');input.blur()}};
 resize();
}
function bind(){
 $('#importWorkspace')&&($('#importWorkspace').onclick=()=>{servicesMenuOpen=false;openImport()});$('#servicesMore')&&($('#servicesMore').onclick=()=>{sync();servicesMenuOpen=!servicesMenuOpen;render()});$('#workspaceMenu').onclick=toggleWorkspaceMenu;
 bindImport();bindSnippet();bindSave();bindCollectionActions();bindUnsavedClose();
 $('#exportWorkspace')&&($('#exportWorkspace').onclick=async()=>{sync();try{const path=await invoke('export_workspace',{workspace:state});if(path)toast(path)}catch(e){toast(String(e))}});

 bindGitControls();
 $('#appSettings')?.addEventListener('click',openAppSettings);

 $('#binaryFromWorkingDirectory')?.addEventListener('click',async()=>{
  const id=selectedTab,token={};binaryLoads.set(id,token);
  try{const path=await invoke('settings_choose_path',{kind:'requestFile'});if(!path)return;const file=await invoke('settings_read_request_file',{path}),target=reqs().find(r=>r.id===id);if(!target||binaryLoads.get(id)!==token)return;target.binaryBytes=file.bytes;target.binaryName=file.name;persist();if(selectedTab===id){sync();render()}}
  catch(error){toast(String(error?.message||error))}finally{if(binaryLoads.get(id)===token)binaryLoads.delete(id)}
 });
 $('#authType')&&($('#authType').onchange=()=>{sync();render()});
 $('#envSelect').onchange=e=>{sync();state.activeEnvironmentId=e.target.value;persist();render()};
 document.querySelectorAll('[data-response-view]').forEach(b=>b.onclick=()=>{sync();responseView=b.dataset.responseView;render()});
 $('#saveResponse')&&($('#saveResponse').onclick=async()=>{if(!response)return;try{toast(await invoke('export_response',{body:response.body}))}catch(e){toast(String(e))}});

 $('#sidebarFilter').oninput=e=>{sidebarFilter=e.target.value;sync();render();$('#sidebarFilter').focus();$('#sidebarFilter').setSelectionRange(sidebarFilter.length,sidebarFilter.length)};
 document.querySelectorAll('[data-toggle-collection]').forEach(b=>b.onclick=()=>{sync();const id=b.dataset.toggleCollection;treeSelection={kind:'collection',id,collectionId:id};collapsedCollections.has(id)?collapsedCollections.delete(id):collapsedCollections.add(id);render()});
 document.querySelectorAll('[data-section]').forEach(b=>b.onclick=()=>{const id=b.dataset.section;expandedSections.has(id)?expandedSections.delete(id):expandedSections.add(id);sync();render()});
 document.querySelectorAll('[data-edit-env]').forEach(b=>b.onclick=()=>openEnvironmentEditor(b.dataset.editEnv));
 $('#rawFormat')&&($('#rawFormat').onchange=e=>{sync();current().rawFormat=e.target.value;persist();render()});
 $('#beautifyBody')&&($('#beautifyBody').onclick=beautifyBody);
 $('#binaryFile')&&($('#binaryFile').onchange=async e=>{const file=e.target.files[0],id=selectedTab;if(!file)return;const token={};binaryLoads.set(id,token);try{const bytes=new Uint8Array(await file.arrayBuffer()),target=reqs().find(r=>r.id===id);if(!target||binaryLoads.get(id)!==token)return;target.binaryBytes=Array.from(bytes);target.binaryName=file.name;persist();if(selectedTab===id){sync();render()}}catch(error){toast('Unable to read file: '+String(error?.message||error))}finally{if(binaryLoads.get(id)===token)binaryLoads.delete(id)}});
 document.querySelectorAll('[data-view]').forEach(x=>x.onclick=()=>{sync();if(view==='services'){try{collectMock()}catch(e){toast(e.message);return}}view=x.dataset.view;servicesMenuOpen=false;persist();render()});
 bindWorkPanels();bindServices();
 document.querySelectorAll('[data-open-request]').forEach(x=>x.onclick=()=>openRequest(x.dataset.openRequest));
 document.querySelectorAll('[data-history]').forEach(x=>x.onclick=()=>{const h=state.history.find(a=>a.id===x.dataset.history);if(h){const clone=JSON.parse(JSON.stringify(h));clone.id='history-'+Date.now();delete clone.at;if(!state.collections.length)state.collections.push({id:uniqueId('c'),name:'My Collection',items:[],folders:[]});clone.folderId=null;state.collections[0].items.push(clone);markRequestUnsaved(clone);openRequest(clone.id)}});
 document.querySelectorAll('[data-select-tab]').forEach(x=>x.onclick=e=>{if(!e.target.closest('[data-close-tab]'))selectWorkspaceTab(x.dataset.selectTab)});
 document.querySelectorAll('[data-close-tab]').forEach(x=>x.onclick=e=>{e.stopPropagation();closeWorkspaceTab(x.dataset.closeTab)});
 document.querySelectorAll('[data-builder]').forEach(x=>x.onclick=()=>{sync();activeTab=x.dataset.builder;render()});
 document.querySelectorAll('[name=bodyType]').forEach(x=>x.onchange=()=>{sync();current().bodyType=x.value;persist();render()});
 $('#send')&&($('#send').onclick=send); $('#save')&&($('#save').onclick=openSave); $('#addRequest').onclick=()=>view==='services'?openMockCreate():newRequest();$('#newTab').onclick=()=>newRequest();
 $('#addCollection')&&($('#addCollection').onclick=()=>openEntityDialog('create','collection'));
 $('#openEnv')&&($('#openEnv').onclick=()=>openEnvironmentEditor(null,{create:true}));$('#envButton').onclick=()=>openEnvironmentEditor();
 $('#clearHistory')&&($('#clearHistory').onclick=()=>{state.history=[];persist();render()});

 document.querySelectorAll('[data-bulk]').forEach(b=>b.onclick=()=>{sync();const kind=b.dataset.bulk;bulkEditors.has(kind)?bulkEditors.delete(kind):bulkEditors.add(kind);render()});
 document.querySelectorAll('[data-add-row]').forEach(b=>b.onclick=()=>{const kind=b.dataset.addRow;const rows=document.querySelectorAll('.key-row');const last=rows[rows.length-1];last?.querySelector(`[data-${kind}-key]`)?.focus()});
 document.querySelectorAll('[data-delete-param],[data-delete-header],[data-delete-bodyfield]').forEach(b=>b.onclick=()=>{const attr=Object.keys(b.dataset)[0],kind=attr.replace('delete','').toLowerCase(),target=kind==='param'?'params':kind==='header'?'headers':'bodyFields';sync();const r=current();r[target]=mapRows(r[target]);r[target].splice(+b.dataset[attr],1);if(kind==='param')updateQuery(r);persist();render()});
 document.querySelectorAll('[data-param-key],[data-header-key],[data-bodyfield-key]').forEach(input=>input.oninput=()=>{const row=input.closest('.key-row');if(input.value)row.querySelector('input[type=checkbox]').checked=true;const table=row.parentElement;if(row===table.querySelector('.key-row:last-of-type')){const kind=input.hasAttribute('data-param-key')?'param':input.hasAttribute('data-header-key')?'header':'bodyfield';const last=Array.from(table.querySelectorAll('.key-row')).at(-1);if(last===row&&input.value){sync({deferSave:true});const index=table.querySelectorAll('.key-row').length;row.insertAdjacentHTML('afterend',keyRow(kind,index,'','',false));bind()}}});
 $('#url')&&($('#url').onpaste=e=>{const text=e.clipboardData?.getData('text/plain')||'';if(!/^\s*curl(?:\.exe)?(?:\s|$)/i.test(text))return;e.preventDefault();try{const parsed=parseCurl(text);sync();applyCurl(parsed,false)}catch(error){toast('Import failed: '+error.message)}});
 $('#url')&&($('#url').onchange=()=>{sync({urlInput:true});render()});
 bindEnv();bindHighlights();bindHeaderSuggestions();bindLayout();bindRequestTabs();bindRequestName();
 const editor=$('.canvas');if(editor&&!isMockTab())for(const event of ['input','change'])editor['on'+event]=e=>{if(!e.target.matches('input,textarea,select'))return;sync({urlInput:e.type==='change',deferSave:true});refreshDirtyTabs()};
}
function cancelSaveDialog(){if(saveInProgress)return;showSave=false;saveTarget=null;saveCloseTarget=null;saveRequestId=null;saveError='';render()}
function beginSaveRequest(id,closeAfter=false){const r=reqs().find(r=>r.id===id);if(!r)return;closePromptTarget=null;saveCloseTarget=closeAfter?id:null;saveRequestId=id;saveTarget=saveTargetFor(r);saveNameDraft=r.name;saveError='';showSave=true;saveCollectionFilter='';render();$('#saveRequestName')?.focus()}
function bindUnsavedClose(){if(!closePromptTarget)return;const id=closePromptTarget;const close=()=>{closePromptTarget=null;render()};$('#closeUnsaved').onclick=close;$('#cancelUnsaved').onclick=close;$('#alwaysDiscardUnsaved').onchange=e=>{alwaysDiscardUnsaved=e.target.checked;try{localStorage.setItem('localpostman-always-discard-unsaved',String(alwaysDiscardUnsaved))}catch{}};$('#discardUnsaved').onclick=()=>discardRequestAndClose(id);$('#saveUnsaved').onclick=()=>beginSaveRequest(id,true);$('#saveUnsaved').focus()}
function openSave(){sync();const r=reqs().find(r=>r.id===selectedTab);if(r)beginSaveRequest(r.id)}
function saveDialog(){const selected=saveTarget,c=state.collections.find(c=>c.id===selected?.collectionId),folder=c?.folders.find(f=>f.id===selected?.folderId);const collections=state.collections.filter(c=>!saveCollectionFilter||c.name.toLowerCase().includes(saveCollectionFilter.toLowerCase())||c.folders.some(f=>f.name.toLowerCase().includes(saveCollectionFilter.toLowerCase())));return `<div class="modal-backdrop"><div class="save-modal" role="dialog" aria-label="Save request" aria-modal="true"><header><strong>SAVE REQUEST</strong><button id="closeSave">×</button></header><div class="save-form"><label>Request name<input id="saveRequestName" value="${esc(saveNameDraft)}"/></label><div class="save-to"><span>Save to</span><strong>${c?esc(c.name+(folder?' / '+folder.name:'')):'Select a collection'}</strong></div><label class="save-search">${icon('filter')}<input id="saveCollectionFilter" placeholder="Search for collection or folder" value="${esc(saveCollectionFilter)}"/></label><div id="saveError" class="save-error" role="alert">${esc(saveError)}</div><div class="save-tree">${collections.map(c=>`<div class="save-collection ${selected?.collectionId===c.id&&!selected.folderId?'selected':''}" data-save-collection="${esc(c.id)}">${icon('folder')}<span>${esc(c.name)}</span></div>${(c.folders||[]).map(f=>`<div class="save-folder ${selected?.collectionId===c.id&&selected.folderId===f.id?'selected':''}" data-save-folder="${esc(c.id)}:${esc(f.id)}">${icon('folder')}<span>${esc(folderPath(c,f.id))}</span></div>`).join('')}`).join('')||'<div class="save-no-results">No collections or folders</div>'}</div></div><footer><button id="newCollection" class="save-link">New Collection</button>${c?'<button id="newFolder" class="save-link">New folder</button>':''}<span></span><button id="cancelSave">Cancel</button><button id="confirmSave" class="save-primary" ${c?'':'disabled'}>Save</button></footer></div></div>`}
function saveTargetFor(r){const c=state.collections.find(c=>c.items.some(x=>x.id===r.id));return c?{collectionId:c.id,folderId:r.folderId||null}:null}
async function confirmRequestSave(){
 if(saveInProgress)return;
 const r=reqs().find(r=>r.id===saveRequestId),target=state.collections.find(c=>c.id===saveTarget?.collectionId);
 if(!r||!target)return;
 const saved={...cloneRequest(r),name:$('#saveRequestName').value.trim()||'Untitled Request',folderId:target.folders.some(f=>f.id===saveTarget.folderId)?saveTarget.folderId:null};
 const snapshot=workspaceSnapshot(),destination=snapshot.collections.find(c=>c.id===target.id),savedIndex=destination.items.findIndex(x=>x.id===r.id);for(const c of snapshot.collections)c.items=c.items.filter(x=>x.id!==r.id);if(savedIndex<0)destination.items.push(saved);else destination.items.splice(savedIndex,0,saved);delete snapshot.editorSession.requestBaselines[r.id];
 const closeAfterSave=saveCloseTarget;saveInProgress=true;saveError='';$('.save-modal').setAttribute('aria-busy','true');$('.save-modal').inert=true;$('#confirmSave').textContent='Saving…';
 try{
  cancelScheduledPersistence();await invoke('save_workspace',{workspace:snapshot,workspaceId:workspaceCatalog.find(w=>w.active)?.id});
  const owner=state.collections.find(c=>c.items.some(x=>x.id===r.id));if(owner!==target){if(owner)owner.items=owner.items.filter(x=>x.id!==r.id);target.items.push(r)}
  Object.assign(r,saved);setRequestBaseline(r);showSave=false;saveTarget=null;saveCloseTarget=null;saveRequestId=null;saveError='';saveInProgress=false;
  collapsedCollections.delete(target.id);revealFolder(target,r.folderId);
  if(closeAfterSave)removeWorkspaceTab(closeAfterSave);else{render();toast('Request saved')}
 }catch(error){saveInProgress=false;saveError='Could not save request: '+String(error?.message||error);render();$('#confirmSave')?.focus()}
}
function bindSave(){if(!showSave)return;$('#closeSave').onclick=cancelSaveDialog;$('#cancelSave').onclick=cancelSaveDialog;$('#saveRequestName').oninput=e=>{saveNameDraft=e.target.value};$('#saveCollectionFilter').oninput=e=>{saveCollectionFilter=e.target.value;render();$('#saveCollectionFilter')?.focus()};document.querySelectorAll('[data-save-collection]').forEach(b=>b.onclick=()=>{saveTarget={collectionId:b.dataset.saveCollection,folderId:null};render()});document.querySelectorAll('[data-save-folder]').forEach(b=>b.onclick=()=>{const [collectionId,folderId]=b.dataset.saveFolder.split(':');saveTarget={collectionId,folderId};render()});$('#newCollection').onclick=()=>openEntityDialog('create','collection',null,null,true);$('#newFolder')?.addEventListener('click',()=>openEntityDialog('create','folder',saveTarget.collectionId,saveTarget.folderId,true));$('#confirmSave')?.addEventListener('click',confirmRequestSave)}
document.addEventListener('keydown',e=>{
 if(!closePromptTarget&&!showSave)return;
 if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();if(entityDialog){entityDialog=null;render()}else if(closePromptTarget){closePromptTarget=null;render()}else cancelSaveDialog();return}
 if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='s'){e.preventDefault();e.stopImmediatePropagation();return}
 if(e.key==='Tab'){const dialog=$('.entity-modal')||$('.unsaved-modal')||$('.save-modal'),fields=[...dialog.querySelectorAll('button:not(:disabled),input,select,textarea')];if(!fields.length)return;const first=fields[0],last=fields.at(-1);if(e.shiftKey&&(document.activeElement===first||!dialog.contains(document.activeElement))){e.preventDefault();last.focus()}else if(!e.shiftKey&&(document.activeElement===last||!dialog.contains(document.activeElement))){e.preventDefault();first.focus()}}
},true);
let saveTarget=null;
const serviceDefinitions={monitors:{label:'Monitors',singular:'Monitor',key:'monitors'},webhooks:{label:'Webhooks',singular:'Webhook',key:'webhooks'},flows:{label:'Deployed Flows',singular:'Deployed Flow',key:'deployedFlows'}};
const serviceExpanded=new Set(['mocks']);
let serviceDrafts={},serviceRuntime={},serviceErrors={};
const servicePending=new Set();
const serviceTabInfo=id=>{const match=/^service:(monitors|webhooks|flows):(.+)$/.exec(id);return match?{kind:match[1],id:match[2]}:null};
function serviceTitle(id){const info=serviceTabInfo(id);if(!info)return '';const def=serviceDefinitions[info.kind];return info.id==='create'?'Create '+def.singular:state[def.key]?.find(x=>x.id===info.id)?.name||''}
function serviceSidebar(){return Object.entries(serviceDefinitions).map(([kind,def])=>{const open=serviceExpanded.has(kind),items=(state[def.key]||[]).filter(x=>x.name.toLowerCase().includes(sidebarFilter.toLowerCase()));return `<section class="secondary-service ${open?'expanded':''}"><button class="service-group" data-service-toggle="${kind}" aria-expanded="${open}"><span class="service-chevron">${open?'⌄':'›'}</span>${def.label.toUpperCase()}</button>${open?`<div class="secondary-service-list">${items.length?items.map(item=>`<button class="mock-card ${selectedTab==='service:'+kind+':'+item.id?'selected':''}" data-service-open="${kind}:${esc(item.id)}">${icon('services')}<span>${esc(item.name)}</span></button>`).join(''):`<div class="panel-empty"><strong>${sidebarFilter?'No matching items':'No items in this panel'}</strong></div>`}<div class="mock-list-actions"><button class="mock-create-button" data-service-create="${kind}">${icon('add')} Create</button></div></div>`:''}</section>`}).join('')}
function openService(kind,id='create'){sync();const tab='service:'+kind+':'+id;if(!openTabs.includes(tab))openTabs.push(tab);if(id==='create'&&!serviceDrafts[kind])serviceDrafts[kind]={name:'New '+serviceDefinitions[kind].singular,collectionId:'',environmentId:'',schedule:'interval',intervalMinutes:60,time:'18:00',runNow:false,retry:false,timeout:30000,delay:0,followRedirects:true,verifySsl:true,port:0,path:kind==='flows'?'/flow':'/webhook'};selectedTab=tab;serviceExpanded.add(kind);render()}
function serviceConfig(){const info=serviceTabInfo(selectedTab);if(!info)return null;return info.id==='create'?serviceDrafts[info.kind]:state[serviceDefinitions[info.kind].key]?.find(x=>x.id===info.id)}
function collectService(){const config=serviceConfig();if(!config||!$('#serviceName')||serviceRuntime[config.id]?.running||servicePending.has(config))return;for(const [id,key]of [['serviceName','name'],['serviceCollection','collectionId'],['serviceEnvironment','environmentId'],['serviceSchedule','schedule'],['serviceTime','time'],['servicePath','path']])if($('#'+id))config[key]=$('#'+id).value;for(const [id,key]of [['serviceInterval','intervalMinutes'],['serviceTimeout','timeout'],['serviceDelay','delay'],['servicePort','port']])if($('#'+id))config[key]=Number($('#'+id).value);for(const [id,key]of [['serviceRunNow','runNow'],['serviceRetry','retry'],['serviceRedirects','followRedirects'],['serviceSsl','verifySsl']])if($('#'+id))config[key]=$('#'+id).checked}
function servicePage(){const info=serviceTabInfo(selectedTab),def=serviceDefinitions[info.kind],config=serviceConfig();if(!config)return '';const creating=info.id==='create',runtime=serviceRuntime[config.id],runs=runtime?.runs||config.runs||[],busy=servicePending.has(config),locked=busy||runtime?.running;return `<section class="service-workspace-page"><header class="service-page-heading"><input id="serviceName" ${locked?'disabled':''} aria-label="${def.singular} name" value="${esc(config.name)}"/><div>${creating?`<button id="serviceCancel" ${busy?'disabled':''}>Cancel</button><button id="serviceSave" class="primary" ${locked?'disabled':''}>Create ${def.singular}</button>`:`<button id="serviceDelete" ${busy?'disabled':''}>Delete</button><button id="serviceSave" ${locked?'disabled':''}>Save</button><button id="serviceRun" class="primary" ${locked?'disabled':''}>Run now</button><button id="serviceToggle" ${busy?'disabled':''}>${runtime?.running?'Stop':info.kind==='monitors'?'Start schedule':'Start'}</button>`}</div></header><div class="service-page-form">${runtime?.running?'<p class="service-running-note">Stop the service to change its configuration.</p>':''}<fieldset class="service-config-fields" ${locked?'disabled':''}><label>${info.kind==='monitors'?'What to monitor?':info.kind==='webhooks'?'Collection to run when the webhook is called':'Collection workflow to deploy'}<select id="serviceCollection"><option value="">Select a collection</option>${state.collections.map(c=>`<option value="${esc(c.id)}" ${c.id===config.collectionId?'selected':''}>${esc(c.name)}</option>`).join('')}</select></label>${info.kind==='monitors'?`<label>How to run the monitor?<select id="serviceSchedule"><option value="interval" ${config.schedule==='interval'?'selected':''}>On schedule — interval</option><option value="daily" ${config.schedule==='daily'?'selected':''}>On schedule — every day</option><option value="manual" ${config.schedule==='manual'?'selected':''}>Run manually</option></select></label><div class="service-schedule-row"><label>Every (minutes)<input id="serviceInterval" type="number" min="1" value="${config.intervalMinutes||60}"/></label><label>Time<input id="serviceTime" type="time" value="${esc(config.time||'18:00')}"/></label></div><label>Runner<input value="Local desktop" readonly/></label>`:`<div class="service-schedule-row"><label>Port<input id="servicePort" type="number" min="0" max="65535" value="${config.port||0}"/></label><label>Path<input id="servicePath" value="${esc(config.path)}"/></label></div><p class="service-local-note">Runs on this computer. The endpoint is available while the desktop app is running.</p>${runtime?.port?`<label>URL<input readonly value="http://127.0.0.1:${runtime.port}${esc(config.path)}"/></label>`:''}`}<label>Environment<select id="serviceEnvironment"><option value="">No Environment</option>${state.environments.map(e=>`<option value="${esc(e.id)}" ${e.id===config.environmentId?'selected':''}>${esc(e.name)}</option>`).join('')}</select></label><div class="service-options">${creating?`<label><input id="serviceRunNow" type="checkbox" ${config.runNow?'checked':''}/> Run now</label>`:''}<label><input id="serviceRetry" type="checkbox" ${config.retry?'checked':''}/> Retry if run fails</label><label>Request timeout (ms)<input id="serviceTimeout" type="number" min="1" value="${config.timeout||30000}"/></label><label>Delay before requests (ms)<input id="serviceDelay" type="number" min="0" value="${config.delay||0}"/></label><label><input id="serviceRedirects" type="checkbox" ${config.followRedirects?'checked':''}/> Follow redirects</label><label><input id="serviceSsl" type="checkbox" ${config.verifySsl?'checked':''}/> Enable SSL validation</label></div></fieldset><div id="serviceError" role="alert">${esc(serviceErrors[selectedTab]||'')}</div>${!creating?`<div class="service-run-header"><h3>Run history</h3><button id="serviceRefresh" ${busy?'disabled':''}>Refresh</button></div><div class="service-run-list">${runs.length?runs.slice().reverse().map(run=>`<details><summary><span class="run-status ${run.ok?'ok':'failed'}">${run.ok?'Passed':'Failed'}</span> ${esc(new Date(run.at).toLocaleString())} · ${run.requests?.length||0} requests</summary>${(run.requests||[]).map(r=>`<div><span>${esc(r.method)} ${esc(r.url)}</span><strong>${esc(r.error||r.status)}</strong><small>${r.time_ms||0} ms</small></div>`).join('')}</details>`).join(''):'<p>No runs yet</p>'}</div>`:''}</div></section>`}
function serviceRequests(config){const collection=state.collections.find(c=>c.id===config.collectionId);if(!collection)throw Error('Select a collection');if(!collection.items.length)throw Error('The selected collection has no requests');if(collection.items.length>200)throw Error('A local run supports up to 200 requests');const environment=state.environments.find(e=>e.id===config.environmentId);return collection.items.map(r=>{const request=resolvedRequest(r,{environment:environment||null,settings:{timeout:config.timeout,followRedirects:config.followRedirects,verifySsl:config.verifySsl}});if(!/^https?:\/\//i.test(request.url)||/\{\{/.test(request.url))throw Error('Resolve the HTTP URL for '+r.name);return request})}
function serviceRuntimeConfig(config){const info=serviceTabInfo(selectedTab);let interval=Math.max(1,config.intervalMinutes||60)*60;let initialDelay=interval;if(config.schedule==='daily'){interval=86400;const [hours,minutes]=(config.time||'18:00').split(':').map(Number);const due=new Date();due.setHours(hours,minutes,0,0);if(due.getTime()<=Date.now())due.setDate(due.getDate()+1);initialDelay=Math.ceil((due.getTime()-Date.now())/1000)}return {initial_delay_seconds:initialDelay,id:config.id,kind:info.kind==='monitors'?'monitor':info.kind==='webhooks'?'webhook':'flow',requests:serviceRequests(config),interval_seconds:interval,port:config.port||0,path:config.path||'/webhook',retry:config.retry,delay_ms:config.delay||0}}
function validateService(config,info){
 if(!config.name.trim())throw Error('Name is required');
 if(info.kind==='monitors'&&(!Number.isFinite(config.intervalMinutes)||config.intervalMinutes<1||!/^\d{2}:\d{2}$/.test(config.time||'')))throw Error('Use a valid interval and time');
 if(!state.collections.some(c=>c.id===config.collectionId))throw Error('Select a collection');
 if(info.kind!=='monitors'&&(!config.path?.startsWith('/')||/[?#\s]/.test(config.path)||!Number.isInteger(config.port)||config.port<0||config.port>65535))throw Error('Use a /path and a valid local port');
 if(!Number.isFinite(config.timeout)||config.timeout<1||config.timeout>30000||!Number.isFinite(config.delay)||config.delay<0||config.delay>60000)throw Error('Use a timeout from 1 to 30000 ms and a delay from 0 to 60000 ms');
}
function showServiceError(tab,error){serviceErrors[tab]=String(error?.message||error);if(selectedTab===tab){const node=$('#serviceError');if(node)node.textContent=serviceErrors[tab]}else toast(serviceErrors[tab])}
async function serviceAction(action){
 const tab=selectedTab,config=serviceConfig(),info=serviceTabInfo(tab);if(!config||servicePending.has(config)||info.id==='create')return;
 try{
  if(action!=='stop'){if(serviceRuntime[config.id]?.running)return;collectService();validateService(config,info)}
  const args=action==='stop'?{id:config.id}:{config:serviceRuntimeConfig(config)};
  servicePending.add(config);delete serviceErrors[tab];render();
  if(action!=='stop')await flushPersistence(true);
  const result=await invoke(action==='stop'?'service_stop':action==='run'?'service_run':'service_start',args);
  if(result)serviceRuntime[config.id]=result;else if(action==='stop')serviceRuntime[config.id]={...serviceRuntime[config.id],running:false};
  config.runs=serviceRuntime[config.id]?.runs||[];await persist();
 }catch(error){showServiceError(tab,error)}finally{servicePending.delete(config);if(selectedTab===tab)render()}
}
async function saveService(){
 const tab=selectedTab,info=serviceTabInfo(tab),config=serviceConfig();if(!config||servicePending.has(config)||serviceRuntime[config.id]?.running)return;
 let created=false,next=tab;
 try{
  collectService();validateService(config,info);servicePending.add(config);delete serviceErrors[tab];render();
  const runNow=Boolean(config.runNow);config.runNow=false;
  if(info.id==='create'){config.id=uniqueId('service');state[serviceDefinitions[info.kind].key].push(config);created=true;next='service:'+info.kind+':'+config.id}
  await flushPersistence(true);
  if(created){const index=openTabs.indexOf(tab);if(index>=0)openTabs[index]=next;if(selectedTab===tab)selectedTab=next;delete serviceDrafts[info.kind]}
  servicePending.delete(config);if(selectedTab===next)render();
  if(runNow&&selectedTab===next)await serviceAction('run');
 }catch(error){if(created){state[serviceDefinitions[info.kind].key]=state[serviceDefinitions[info.kind].key].filter(x=>x!==config);delete config.id}showServiceError(tab,error)}
 finally{servicePending.delete(config);if(selectedTab===tab||selectedTab===next)render()}
}
async function refreshService(){
 const tab=selectedTab,config=serviceConfig();if(!config||servicePending.has(config))return;
 try{collectService();servicePending.add(config);render();const items=await invoke('service_status');for(const runtime of items)serviceRuntime[runtime.id]=runtime;config.runs=serviceRuntime[config.id]?.runs||[];await persist();delete serviceErrors[tab]}
 catch(error){showServiceError(tab,error)}finally{servicePending.delete(config);if(selectedTab===tab)render()}
}
async function deleteService(){
 const tab=selectedTab,info=serviceTabInfo(tab),config=serviceConfig();if(!config||servicePending.has(config))return;
 const key=serviceDefinitions[info.kind].key;
 try{
  servicePending.add(config);delete serviceErrors[tab];render();
  if(serviceRuntime[config.id]?.running)await invoke('service_stop',{id:config.id});
  delete serviceRuntime[config.id];
  const snapshot=workspaceSnapshot();snapshot[key]=snapshot[key].filter(x=>x.id!==info.id);
  cancelScheduledPersistence();await invoke('save_workspace',{workspace:snapshot,workspaceId:workspaceCatalog.find(w=>w.active)?.id});
  state[key]=state[key].filter(x=>x.id!==info.id);closeWorkspaceTab(tab);
 }catch(error){showServiceError(tab,error)}finally{servicePending.delete(config);if(selectedTab===tab)render()}
}

function bindServices(){
 document.querySelectorAll('[data-service-toggle]').forEach(b=>b.onclick=()=>{sync();const kind=b.dataset.serviceToggle;serviceExpanded.has(kind)?serviceExpanded.delete(kind):serviceExpanded.add(kind);render()});
 document.querySelectorAll('[data-service-create]').forEach(b=>b.onclick=()=>openService(b.dataset.serviceCreate));
 document.querySelectorAll('[data-service-open]').forEach(b=>b.onclick=()=>{const [kind,id]=b.dataset.serviceOpen.split(':');openService(kind,id)});
 if(!serviceTabInfo(selectedTab))return;
 $('#serviceCancel')?.addEventListener('click',()=>closeWorkspaceTab(selectedTab));$('#serviceSave')?.addEventListener('click',saveService);
 $('#serviceRun')?.addEventListener('click',()=>serviceAction('run'));
 $('#serviceToggle')?.addEventListener('click',()=>{const config=serviceConfig();if(serviceTabInfo(selectedTab).kind==='monitors'&&config.schedule==='manual'&&!serviceRuntime[config.id]?.running){showServiceError(selectedTab,'Choose a schedule before starting');return}serviceAction(serviceRuntime[config.id]?.running?'stop':'start')});
 $('#serviceRefresh')?.addEventListener('click',refreshService);$('#serviceDelete')?.addEventListener('click',deleteService);
}

function mockPanel(){
 const open=serviceExpanded.has('mocks');
 const cards=state.mockServers.filter(x=>!sidebarFilter||x.name.toLowerCase().includes(sidebarFilter.toLowerCase())).map(x=>`<button class="mock-card ${selectedTab==='mock:'+x.id?'selected':''}" data-mock-select="${esc(x.id)}">${icon('services')}<span>${esc(x.name)}${mockRuntime[x.id]?`<small>http://127.0.0.1:${mockRuntime[x.id].port}</small>`:''}</span></button>`).join('');
 const create='<button id="'+(cards?'createMock':'createMockEmpty')+'" class="mock-create-button">'+icon('add')+' Create</button>';
 const body=cards?cards+'<div class="mock-list-actions">'+create+'</div>':'<div class="panel-empty"><strong>'+(sidebarFilter?'No matching mock servers':'No items in this panel')+'</strong>'+create+'</div>';
 return `<div class="service-groups"><section class="service-primary service-mock-section"><button class="service-group" data-service-toggle="mocks" aria-expanded="${open}"><span class="service-chevron">${open?'⌄':'›'}</span>MOCK SERVERS</button>${open?`<div class="mock-panel">${body}</div>`:''}</section><div class="service-secondary">${serviceSidebar()}</div></div>`;
}
function mockRouteFromRequest(r){
 let path='/';try{path=new URL(r.url).pathname}catch{path=String(r.url||'').replace(/^\{\{[^}]+\}\}/,'').split(/[?#]/)[0]||'/';if(!path.startsWith('/'))path='/'+path}
 const example=r.examples?.[0],headers=Object.fromEntries(mapRows(example?.headers).filter(h=>h.enabled!==false&&h.key).map(h=>[h.key,String(h.value??'')]));
 return {id:uniqueId('route'),sourceRequestId:r.id,name:r.name,method:(r.method||'GET').toUpperCase(),path,status:Number.isInteger(example?.code)&&example.code>=100&&example.code<=599?example.code:200,body:example?.body??'{}',headers:Object.keys(headers).length?headers:{'Content-Type':'application/json'},delay_ms:0};
}
function mockSelectedRoute(m){const index=mockRouteSelections[m.id]??0;return Math.max(0,Math.min(index,Math.max(0,(m.routes||[]).length-1)))}
function importMockCollection(m){
 const collection=state.collections.find(c=>c.id===m.collectionId);if(!collection)return 0;
 m.routes=m.routes||[];let added=0;
 for(const request of collection.items){const route=mockRouteFromRequest(request),existing=m.routes.find(r=>r.sourceRequestId===request.id)||m.routes.find(r=>r.method.toUpperCase()===route.method.toUpperCase()&&r.path===route.path);if(existing){if(!existing.sourceRequestId)existing.sourceRequestId=request.id;continue}m.routes.push(route);added++}
 return added;
}
function mockDetailPage(){
 const m=state.mockServers.find(x=>x.id===selectedMockId);if(!m)return '';
 m.routes=m.routes||[];selectedRoute=mockSelectedRoute(m);mockRouteSelections[m.id]=selectedRoute;
 const route=m.routes[selectedRoute],running=mockRuntime[m.id],busy=mockPending.has(m.id),locked=running||busy,collection=state.collections.find(c=>c.id===m.collectionId);
 return `<div class="mock-detail mock-workspace-detail mock-routes-page"><div class="mock-detail-title"><input id="mockName" aria-label="Mock server name" value="${esc(m.name)}" ${locked?'disabled':''}/><div class="mock-server-actions"><button id="deleteMock" ${busy?'disabled':''}>Delete</button><button id="saveMockRoute" ${locked?'disabled':''}>Save</button><button id="toggleMock" class="primary" ${busy||(!running&&!m.routes.length)?'disabled':''}>${busy?'Working…':running?'Stop':'Start'}</button><button id="mockRefresh" ${busy?'disabled':''}>Logs</button><button id="closeMockDetail" aria-label="Close mock server">${icon('close')}</button></div></div><fieldset class="mock-server-settings" ${locked?'disabled':''}><label>Collection<select id="mockCollection" aria-label="Mock collection"><option value="">No collection</option>${state.collections.map(c=>`<option value="${esc(c.id)}" ${c.id===m.collectionId?'selected':''}>${esc(c.name)}</option>`).join('')}</select></label><button id="mockImportCollection" ${collection?'':'disabled'}>${icon('add')} Add collection requests</button><label>Port<input id="mockPort" type="number" min="0" max="65535" value="${m.port||0}"/></label></fieldset>${running?`<div class="mock-runtime-url">Running at <code>http://127.0.0.1:${running.port}</code><span>Stop the server to edit routes.</span></div>`:''}<div class="mock-routes-layout"><section class="mock-route-list" aria-label="Mock routes"><header><strong>Routes <span>${m.routes.length}</span></strong><button id="addMockRoute" ${locked?'disabled':''} title="Add route" aria-label="Add route">${icon('add')}</button></header>${m.routes.length?m.routes.map((r,i)=>`<button data-mock-route="${i}" class="mock-route-item ${i===selectedRoute?'selected':''}" aria-current="${i===selectedRoute}"><span class="tree-method ${esc(r.method.toLowerCase())}">${esc(r.method)}</span><span><strong>${esc(r.name||r.path)}</strong><small>${esc(r.path)}</small></span><em>${r.status}</em></button>`).join(''):'<p>No routes yet. Add a route or select a collection.</p>'}</section><section class="mock-route-response">${route?`<div class="mock-route-heading"><strong>${esc(route.name||'Route response')}</strong><button id="deleteMockRoute" ${locked?'disabled':''}>Delete route</button></div><fieldset ${locked?'disabled':''}><div class="mock-route-request"><label>Method<select id="mockMethod">${[...new Set(['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS','*',route.method])].map(v=>`<option ${route.method===v?'selected':''}>${esc(v)}</option>`).join('')}</select></label><label>Path<input id="mockPath" value="${esc(route.path)}" placeholder="/users/1"/></label></div><div class="mock-route-response-settings"><label>Status<input id="mockStatus" type="number" min="100" max="599" value="${route.status||200}"/></label><label>Delay (ms)<input id="mockDelay" type="number" min="0" max="30000" value="${route.delay_ms||0}"/></label></div><label>Response headers<textarea id="mockHeaders" spellcheck="false" aria-label="Response headers">${esc(JSON.stringify(route.headers||{},null,2))}</textarea></label><label>Response body<textarea id="mockBody" spellcheck="false">${esc(route.body??'')}</textarea></label></fieldset>`:'<div class="mock-route-empty">Select a Collection to import its requests, or add your first route.</div>'}</section></div><div id="mockError" role="alert">${esc(mockErrors[m.id]||'')}</div><pre class="mock-logs">${(running?.logs||[]).map(l=>esc(l.method+' '+l.path+' → '+l.status)).join('\n')}</pre></div>`;
}

function mockDeployPage(){const d=mockDraft||{};const sources=d.type==='collection'?state.collections:state.mockServers;const valid=Boolean(d.name?.trim()&&sources.some(x=>x.id===d.sourceId)&&Number.isInteger(d.port)&&d.port>=0&&d.port<=65535);return `<section class="deploy-page"><div class="deploy-page-head"><div><h1>Deploy mock server</h1><p>Create a mock server from an existing mock or collection.</p></div><div><button id="cancelMockDeploy">Cancel</button><button id="confirmMockDeploy" class="primary" ${valid?'':'disabled'}>Deploy</button></div></div><div class="deploy-form"><div class="deploy-choice"><label><input type="radio" name="mockDeployType" value="existing" ${d.type!=='collection'?'checked':''}/> Existing mock</label><label><input type="radio" name="mockDeployType" value="collection" ${d.type==='collection'?'checked':''}/> Existing collection</label></div><label>Name<input id="deployMockName" value="${esc(d.name||'New mock server')}"/></label><label>${d.type==='collection'?'Select collection':'Select mock'}<select id="deployMockSelect"><option value="">${d.type==='collection'?'Select a collection':'Select one or more mocks'}</option>${sources.map(m=>`<option value="${esc(m.id)}" ${m.id===d.sourceId?'selected':''}>${esc(m.name)}</option>`).join('')}</select></label><label>Port<input id="deployMockPort" type="number" min="0" max="65535" value="${d.port||0}"/></label><p class="service-local-note">The server runs at http://127.0.0.1 on this computer. Use 0 to choose an available port when starting.</p></div></section>`}

function collectMock(){
 const m=state.mockServers.find(x=>x.id===selectedMockId);if(!m||!$('#mockPort')||mockRuntime[m.id]||mockPending.has(m.id))return m;
 const name=$('#mockName')?.value.trim()||'';if(!name)throw Error('Name is required');
 const port=Number($('#mockPort').value);if(!Number.isInteger(port)||port<0||port>65535)throw Error('Use a port from 0 to 65535');
 let edited;
 if($('#mockPath')){
  const index=mockSelectedRoute(m),status=Number($('#mockStatus').value),path=$('#mockPath').value.trim(),delay=Number($('#mockDelay').value),method=$('#mockMethod').value;
  if(!path.startsWith('/')||path.includes('?')||path.includes('#')||/\s/.test(path))throw Error('Use an absolute /path without query parameters');
  if(!Number.isInteger(status)||status<100||status>599)throw Error('Use an HTTP status from 100 to 599');
  if(!Number.isInteger(delay)||delay<0||delay>30000)throw Error('Use a response delay from 0 to 30000 ms');
  let headers;try{headers=JSON.parse($('#mockHeaders').value||'{}')}catch{throw Error('Response headers must be a JSON object')}
  if(!headers||Array.isArray(headers)||typeof headers!=='object'||Object.entries(headers).some(([key,value])=>!key.trim()||typeof value!=='string'||/[\r\n]/.test(key+value)))throw Error('Response headers must contain header names and string values');
  if(m.routes.some((r,i)=>i!==index&&r.method.toUpperCase()===method.toUpperCase()&&r.path===path))throw Error('A route with this method and path already exists');
  edited={...(m.routes[index]||{}),method,path,status,body:$('#mockBody').value,headers,delay_ms:delay};
  m.routes[index]=edited;
 }
 m.name=name;m.port=port;return m;
}

async function mockAction(action){
 const tabId=selectedTab,id=tabId.startsWith('mock:')?tabId.slice(5):null,m=state.mockServers.find(x=>x.id===id);
 if(!m||mockPending.has(id))return;
 try{
  if(!(action==='toggle'&&mockRuntime[id]))collectMock();
  mockPending.add(id);delete mockErrors[id];render();
  if(action==='logs'){
   const servers=await invoke('mock_status');mockRuntime=Object.fromEntries(servers.map(server=>[server.id,server]));
  }else if(action==='toggle'&&mockRuntime[id]){
   await invoke('mock_stop',{id});delete mockRuntime[id];
  }else{
   if(action==='toggle'&&!m.routes.length)throw Error('Add at least one route');
   await flushPersistence(true);
   if(action==='toggle')mockRuntime[id]=await invoke('mock_start',{config:cloneRequest(m)});
   else toast('Mock saved locally');
  }
 }catch(error){mockErrors[id]=String(error?.message||error);if(selectedTab!==tabId)toast(m.name+': '+mockErrors[id])}
 finally{mockPending.delete(id);if(selectedTab===tabId)render()}
}

async function deleteMockServer(){
 const tab=selectedTab,id=tab.startsWith('mock:')?tab.slice(5):null,m=state.mockServers.find(x=>x.id===id);if(!m||mockPending.has(id))return;
 try{
  mockPending.add(id);delete mockErrors[id];render();
  if(mockRuntime[id])await invoke('mock_stop',{id});
  delete mockRuntime[id];
  const snapshot=workspaceSnapshot();snapshot.mockServers=snapshot.mockServers.filter(x=>x.id!==id);
  cancelScheduledPersistence();await invoke('save_workspace',{workspace:snapshot,workspaceId:workspaceCatalog.find(w=>w.active)?.id});
  state.mockServers=state.mockServers.filter(x=>x.id!==id);delete mockRouteSelections[id];closeWorkspaceTab(tab);
 }catch(error){mockErrors[id]=String(error?.message||error);if(selectedTab!==tab)toast(m.name+': '+mockErrors[id])}
 finally{mockPending.delete(id);if(selectedTab===tab)render()}
}

function collectMockDraft(){if(!mockDraft||!$('#deployMockName'))return;Object.assign(mockDraft,{name:$('#deployMockName').value,sourceId:$('#deployMockSelect').value,port:Number($('#deployMockPort').value)})}
function bindWorkPanels(){
 $('#createMockEmpty')&&($('#createMockEmpty').onclick=openMockCreate);$('#createMock')&&($('#createMock').onclick=openMockCreate);
 document.querySelectorAll('[data-mock-select]').forEach(b=>b.onclick=()=>openMockServer(b.dataset.mockSelect));
 if(selectedTab===mockCreateTabId){
  $('#cancelMockDeploy').onclick=()=>closeWorkspaceTab(mockCreateTabId);
  document.querySelectorAll('[name=mockDeployType]').forEach(radio=>radio.onchange=()=>{collectMockDraft();mockDraft.type=radio.value;mockDraft.sourceId='';render()});
  const validate=()=>{collectMockDraft();const sources=mockDraft.type==='collection'?state.collections:state.mockServers;$('#confirmMockDeploy').disabled=!mockDraft.name.trim()||!sources.some(x=>x.id===mockDraft.sourceId)||!Number.isInteger(mockDraft.port)||mockDraft.port<0||mockDraft.port>65535};
  $('#deployMockName').oninput=validate;$('#deployMockSelect').onchange=validate;$('#deployMockPort').oninput=validate;
  $('#confirmMockDeploy').onclick=()=>{collectMockDraft();const source=mockDraft.type==='collection'?state.collections.find(x=>x.id===mockDraft.sourceId):state.mockServers.find(x=>x.id===mockDraft.sourceId);if(!source||!mockDraft.name.trim()||!Number.isInteger(mockDraft.port)||mockDraft.port<0||mockDraft.port>65535)return;const routeSource=mockDraft.type==='collection'?source.items.map(mockRouteFromRequest):JSON.parse(JSON.stringify(source.routes||[])),keys=new Set(),routes=routeSource.filter(route=>{const key=(route.method||'GET').toUpperCase()+' '+route.path;if(keys.has(key))return false;keys.add(key);return true});const server={id:uniqueId('m'),name:mockDraft.name.trim(),port:mockDraft.port,routes,collectionId:mockDraft.type==='collection'?source.id:source.collectionId||null};state.mockServers.push(server);const index=openTabs.indexOf(mockCreateTabId);openTabs[index]='mock:'+server.id;selectedTab=openTabs[index];selectedMockId=server.id;mockRouteSelections[server.id]=0;mockDraft=null;persist();render()};
 }
 $('#closeMockDetail')&&($('#closeMockDetail').onclick=()=>closeWorkspaceTab(selectedTab));
 const mutateMock=change=>{try{const m=collectMock();if(!m)return;if(mockRuntime[m.id]||mockPending.has(m.id))throw Error('Stop the server to edit routes');change(m);persist();render()}catch(error){$('#mockError').textContent=error.message}};
 document.querySelectorAll('[data-mock-route]').forEach(button=>button.onclick=()=>{try{const m=collectMock();if(!m)return;mockRouteSelections[m.id]=Number(button.dataset.mockRoute);persist();render()}catch(error){$('#mockError').textContent=error.message}});
 $('#mockCollection')?.addEventListener('change',e=>mutateMock(m=>{m.collectionId=e.target.value||null;importMockCollection(m);mockRouteSelections[m.id]=mockSelectedRoute(m)}));
 $('#mockImportCollection')?.addEventListener('click',()=>mutateMock(m=>{const count=importMockCollection(m);toast(count?`Added ${count} collection request${count===1?'':'s'}`:'Collection requests are already in this mock')}));
 $('#addMockRoute')?.addEventListener('click',()=>mutateMock(m=>{m.routes=m.routes||[];let path='/new-route',suffix=1;while(m.routes.some(r=>r.method==='GET'&&r.path===path))path='/new-route-'+suffix++;m.routes.push({id:uniqueId('route'),method:'GET',path,status:200,body:'{}',headers:{'Content-Type':'application/json'},delay_ms:0});mockRouteSelections[m.id]=m.routes.length-1}));
 $('#deleteMockRoute')?.addEventListener('click',()=>{const m=state.mockServers.find(x=>x.id===selectedMockId);if(!m||mockRuntime[m.id]||mockPending.has(m.id))return;const index=mockSelectedRoute(m);m.routes.splice(index,1);mockRouteSelections[m.id]=Math.min(index,Math.max(0,m.routes.length-1));persist();render()});
 $('#deleteMock')?.addEventListener('click',deleteMockServer);
 $('#saveMockRoute')?.addEventListener('click',()=>mockAction('save'));
 $('#toggleMock')?.addEventListener('click',()=>mockAction('toggle'));
 $('#mockRefresh')?.addEventListener('click',()=>mockAction('logs'));

}
function closeEnvironmentEditor(){if(envSaving)return;showEnv=false;envDraft=null;envSession.clear();envError='';envDeletePrompt=false;render();$('#envButton')?.focus()}
async function saveEnvironmentSession(){
 if(envSaving)return;captureEnvDraft();
 let updates;try{updates=[...envSession.values()].map(collectEnv)}catch(error){envError=error.message;render();return}
 const snapshot=workspaceSnapshot();for(const e of updates){const index=snapshot.environments.findIndex(x=>x.id===e.id);if(index<0)snapshot.environments.push(e);else snapshot.environments[index]=e}snapshot.activeEnvironmentId=envDraft.id;
 envSaving=true;envError='';setEnvironmentBusy();
 try{cancelScheduledPersistence();await invoke('save_workspace',{workspace:snapshot,workspaceId:workspaceCatalog.find(w=>w.active)?.id});state.environments=snapshot.environments;state.activeEnvironmentId=snapshot.activeEnvironmentId;envSaving=false;closeEnvironmentEditor()}
 catch(error){envSaving=false;envError='Could not save environments: '+String(error?.message||error);render()}
}
async function deleteEnvironment(){
 if(envSaving||!envDraft)return;captureEnvDraft();const id=envDraft.id,snapshot=workspaceSnapshot();snapshot.environments=snapshot.environments.filter(x=>x.id!==id);if(snapshot.activeEnvironmentId===id)snapshot.activeEnvironmentId='';
 envSaving=true;setEnvironmentBusy();
 try{cancelScheduledPersistence();await invoke('save_workspace',{workspace:snapshot,workspaceId:workspaceCatalog.find(w=>w.active)?.id});state.environments=snapshot.environments;state.activeEnvironmentId=snapshot.activeEnvironmentId;envSession.delete(id);envSaving=false;envDeletePrompt=false;envError='';const next=[...envSession.values()][0]||state.environments[0];envDraft=next?envSession.get(next.id)||environmentDraft(next):environmentDraft();envSession.set(envDraft.id,envDraft);render()}
 catch(error){envSaving=false;envError='Could not delete environment: '+String(error?.message||error);render()}
}
function setEnvironmentBusy(){const modal=$('.env-modal');if(!modal)return;modal.setAttribute('aria-busy',String(envSaving));for(const control of modal.querySelectorAll('button,input'))control.disabled=envSaving;$('#saveEnv')&&($('#saveEnv').textContent='Saving…')}
function bindEnv(){
 if(!showEnv)return;
 for(const region of document.querySelectorAll('.shell>.globalbar,.shell>.body,.shell>.statusbar'))region.inert=true;
 $('#closeEnv').onclick=closeEnvironmentEditor;$('#cancelEnv')?.addEventListener('click',closeEnvironmentEditor);
 $('.env-editor').oninput=event=>{if(event.target.matches('[data-env-current]'))event.target.dataset.explicit='true';captureEnvDraft()};
 document.querySelectorAll('[data-pick-env]').forEach(b=>b.onclick=()=>{captureEnvDraft();const id=b.dataset.pickEnv;envDraft=envSession.get(id)||environmentDraft(state.environments.find(e=>e.id===id));envSession.set(id,envDraft);envError='';envDeletePrompt=false;render()});
 $('#newEnv').onclick=()=>{captureEnvDraft();envDraft=environmentDraft();envSession.set(envDraft.id,envDraft);envError='';envDeletePrompt=false;render();$('#envName')?.focus()};
 $('#addEnvVar').onclick=()=>{captureEnvDraft();envDraft._editorRows.push({key:'',value:'',current:''});render({captureEnvironment:false});const input=$(`[data-env-key="${envDraft._editorRows.length-1}"]`);input?.focus();input?.scrollIntoView?.({block:'nearest'})};
 document.querySelectorAll('[data-remove-env-row]').forEach(b=>b.onclick=()=>{captureEnvDraft();envDraft._editorRows.splice(Number(b.dataset.removeEnvRow),1);render({captureEnvironment:false})});
 $('#saveEnv')?.addEventListener('click',saveEnvironmentSession);
 $('#deleteEnv')?.addEventListener('click',()=>{captureEnvDraft();envDeletePrompt=true;render();$('#confirmEnvDelete')?.focus()});
 $('#cancelEnvDelete')?.addEventListener('click',()=>{envDeletePrompt=false;render()});$('#confirmEnvDelete')?.addEventListener('click',deleteEnvironment);
 if(envSaving)setEnvironmentBusy();
}
document.addEventListener('keydown',event=>{
 if(!showEnv)return;
 if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();if(envDeletePrompt&&!envSaving){envDeletePrompt=false;render()}else closeEnvironmentEditor();return}
 if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='s'){event.preventDefault();event.stopImmediatePropagation();saveEnvironmentSession();return}
 if(event.key==='Tab'){const fields=[...$('.env-modal').querySelectorAll('button:not(:disabled),input:not(:disabled)')];if(!fields.length)return;const first=fields[0],last=fields.at(-1);if(event.shiftKey&&(document.activeElement===first||!$('.env-modal').contains(document.activeElement))){event.preventDefault();last.focus()}else if(!event.shiftKey&&(document.activeElement===last||!$('.env-modal').contains(document.activeElement))){event.preventDefault();first.focus()}}
},true);

function newRequest(collectionId=null,folderId=null){sync();let c=state.collections.find(c=>c.id===collectionId);if(!c&&!collectionId){const active=reqs().find(r=>r.id===selectedTab);c=state.collections.find(c=>c.id===treeSelection?.collectionId)||state.collections.find(c=>c.items.includes(active))||state.collections[0];if(treeSelection?.kind==='folder')folderId=treeSelection.id}if(!c){c={id:uniqueId('c'),name:'My Collection',items:[],folders:[]};state.collections.push(c)}const r={id:uniqueId('r'),name:'Untitled Request',method:'GET',url:'',headers:[],params:[],body:'',folderId:(c.folders||[]).some(f=>f.id===folderId)?folderId:null};c.items.push(r);markRequestUnsaved(r);collapsedCollections.delete(c.id);revealFolder(c,r.folderId);sidebarFilter='';openTabs.push(r.id);selectedTab=r.id;treeSelection={kind:'request',id:r.id,collectionId:c.id};response=null;activeTab='Params';persist();render()}

function bindRequestTabs(){const strip=$('.tabs-scroll');if(!strip)return;strip.onwheel=e=>{if(strip.scrollWidth<=strip.clientWidth)return;const delta=Math.abs(e.deltaX)>Math.abs(e.deltaY)?e.deltaX:e.deltaY;strip.scrollLeft+=delta;e.preventDefault()};const reveal=()=>{const active=strip.querySelector('.request-tab.selected');if(!active)return;const left=active.offsetLeft-strip.offsetLeft,right=left+active.offsetWidth;if(left<strip.scrollLeft)strip.scrollLeft=left;else if(right>strip.scrollLeft+strip.clientWidth)strip.scrollLeft=right-strip.clientWidth};if(typeof requestAnimationFrame==='function')requestAnimationFrame(reveal);else reveal();}
function openImport({fromSettings=false}={}){
 if(showImport)return;
 sync();importPriorFocus=document.activeElement;importSession++;showImport=true;importText='';importError='';
 const completion=fromSettings?new Promise(resolve=>{importCompletion=resolve}):undefined;
 render();$('#importText')?.focus();return completion;
}
function mountImportDialog(){
 const overlay=$('#importOverlay');
 if(overlay&&settingsPanel?.isOpen()){overlay.classList.add('settings-import-backdrop');document.body.append(overlay)}
}
function closeImportDialog(){
 showImport=false;importSession++;render();
 const complete=importCompletion;importCompletion=null;
 if(complete)complete();else if(importPriorFocus?.isConnected)importPriorFocus.focus();
 importPriorFocus=null;
}
function importDialog(){return `<div id="importOverlay" class="modal-backdrop"><div class="import-modal" role="dialog" aria-modal="true" aria-label="Import"><header><strong>Import</strong><button id="closeImport" aria-label="Close import">×</button></header><p>Paste cURL, Postman Collection JSON (v2 / v2.1), or Hoppscotch Collection JSON, or choose a .json file. Environments and workspace JSON are also supported.</p><textarea id="importText" aria-label="Import text" spellcheck="false" placeholder='curl --url https://example.com\n\n{ "info": { "name": "My collection" }, "item": […] }'>${esc(importText)}</textarea><div class="import-error" role="alert">${esc(importError)}</div><footer><label class="import-file">Choose JSON file<input id="importFile" type="file" accept=".json,application/json"/></label><span></span><button id="cancelImport">Cancel</button><button id="confirmImport">Import</button></footer></div></div>`}
function applyCurl(parsed,create){const {warnings,...request}=parsed;if(create){newRequest()}Object.assign(current(),request);activeTab=request.bodyType==='none'?'Params':'Body';response=null;delete tabResponses[current().id];persist();closeImportDialog();if(warnings.length)toast(warnings.join('; '))}
function bindImport(){
 if(!showImport)return;
 $('#closeImport').onclick=$('#cancelImport').onclick=closeImportDialog;
 $('#importText').oninput=e=>{importText=e.target.value};
 const perform=text=>{
  try {
   if(/^\s*curl(?:\.exe)?(?:\s|$)/i.test(text)){applyCurl(parseCurl(text),true);return}
   const warnings=importData(JSON.parse(text.replace(/^\uFEFF/,'')));
   persist();closeImportDialog();toast(warnings?.length?'Imported. '+warnings.join('; '):'Imported locally');
  }catch(e){importText=text;importError=e.message;render();$('#importText')?.focus()}
 };
 $('#confirmImport').onclick=()=>perform($('#importText').value);
 $('#importFile').onchange=async e=>{
  const session=importSession;
  try{const file=e.target.files[0];if(file){const text=await file.text();if(showImport&&session===importSession)perform(text)}}
  catch(error){if(showImport&&session===importSession){importError=error.message;render();$('#importText')?.focus()}}
 };
}
document.addEventListener('keydown',event=>{
 if(!showImport)return;
 if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();closeImportDialog();return}
 if(event.key==='Tab'){
  const dialog=$('.import-modal'),fields=[...dialog.querySelectorAll(':is(button,input,textarea):not(:disabled)')];
  if(!fields.length)return;const first=fields[0],last=fields.at(-1);
  if(event.shiftKey&&(document.activeElement===first||!dialog.contains(document.activeElement))){event.preventDefault();event.stopImmediatePropagation();last.focus()}
  else if(!event.shiftKey&&(document.activeElement===last||!dialog.contains(document.activeElement))){event.preventDefault();event.stopImmediatePropagation();first.focus()}
 }
},true);
if(window.__TAURI_INTERNALS__){
 listen('open-import',openImport);
 const nativeWindow=getCurrentWindow();let closing=false;
 nativeWindow.onCloseRequested(async event=>{if(closing||workspaceError)return;event.preventDefault();if(workspaceBusy||gitBusy||envSaving)return;try{if(settingsPanel)await settingsPanel.flush();sync();await flushPersistence(true);closing=true;await nativeWindow.destroy()}catch(error){toast('Could not save before closing: '+String(error?.message||error))}});
}
function importData(data){if(!data||typeof data!=='object'||Array.isArray(data))throw Error('Select a Collection JSON object');const id=prefix=>prefix+crypto.randomUUID();if(data&&(data.info||data.collection?.info||typeof data.name==='string'&&Array.isArray(data.folders)&&Array.isArray(data.requests))){const parsed=parseCollection(data,id);state.collections.push(parsed.collection);parsed.collection.items.forEach(setRequestBaseline);view='collections';sidebarFilter='';collapsedCollections.delete(parsed.collection.id);const first=parsed.collection.items[0];if(first){openTabs.push(first.id);selectedTab=first.id;response=null;activeTab='Params'}return parsed.warnings}if(Array.isArray(data.values)){state.environments.push({id:id('e'),name:data.name||'Imported environment',values:Object.fromEntries(data.values.filter(v=>v.enabled!==false).map(v=>[v.key,v.value]))});return}if(Array.isArray(data.collections)){const incoming=normalizeWorkspace(JSON.parse(JSON.stringify(data)));incoming.collections.forEach(c=>{c.id=id('c');const folderIds=new Map((c.folders||[]).map(f=>[f.id,id('f')]));c.folders=(c.folders||[]).map(f=>({...f,id:folderIds.get(f.id),parentId:folderIds.get(f.parentId)||null}));c.items.forEach(r=>{r.id=id('r');r.folderId=folderIds.get(r.folderId)||null;setRequestBaseline(r)});state.collections.push(c)});incoming.environments.forEach(e=>{e.id=id('e');state.environments.push(e)});return}throw Error('Expected Postman or Hoppscotch collection, environment, or LocalPostman workspace')}
function enabledEntries(map,resolveValue=resolve){return mapRows(map).filter(x=>x.enabled!==false&&x.key).map(x=>[resolveValue(x.key),resolveValue(String(x.value??''))])}
function serializeBody(r,resolveValue=resolve){if(r.bodyType==='none'||r.bodyType==='binary')return null;if(r.bodyType==='graphql')return JSON.stringify({query:resolveValue(r.graphqlQuery||''),variables:JSON.parse(resolveValue(r.graphqlVariables||'{}'))});if(r.bodyType==='urlencoded')return new URLSearchParams(enabledEntries(r.bodyFields,resolveValue)).toString();if(r.bodyType==='form-data')return null;return r.body?resolveValue(r.body):null}
function resolve(s){const env=environmentValues();return String(s??'').replace(/\{\{(.*?)\}\}/g,(original,k)=>env[k.trim()]??original)}
function resolvedRequest(r,{environment=activeEnv(),settings={}}={}){
 const values=environmentValues(r,environment),resolveValue=value=>String(value??'').replace(/\{\{(.*?)\}\}/g,(original,key)=>values[key.trim()]??original),entries=value=>enabledEntries(value,resolveValue).map(([key,value])=>appSettings.general.trimKeysAndValues?[key.trim(),value.trim()]:[key,value]);
 let url=resolveValue(r.url).split('#')[0];const query=r.params===undefined?new URLSearchParams(url.split('?')[1]||''):new URLSearchParams(entries(r.params));url=url.split('?')[0];
 const auth=r.auth||{},headers=entries(r.headers),addDefaultHeader=(key,value)=>{if(key&&!headers.some(([name])=>name.toLowerCase()===key.toLowerCase()))headers.push([key,value])};
 if(auth.type==='API Key'&&auth.location==='query')query.set(resolveValue(auth.key),resolveValue(auth.value));
 if([...query].length)url+='?'+query;
 if(auth.type==='Bearer Token')addDefaultHeader('Authorization','Bearer '+resolveValue(auth.token));
 if(auth.type==='Basic Auth')addDefaultHeader('Authorization','Basic '+btoa(Array.from(new TextEncoder().encode(resolveValue(auth.username)+':'+resolveValue(auth.password)),b=>String.fromCharCode(b)).join('')));
 if(auth.type==='API Key'&&auth.location!=='query')addDefaultHeader(resolveValue(auth.key),resolveValue(auth.value));
 if(appSettings.general.sendNoCacheHeader){addDefaultHeader('Cache-Control','no-cache');addDefaultHeader('Pragma','no-cache')}
 const type=r.bodyType||'raw';if(['raw','graphql','urlencoded'].includes(type))addDefaultHeader('Content-Type',type==='graphql'?'application/json':type==='urlencoded'?'application/x-www-form-urlencoded':rawFormats[r.rawFormat||'JSON']);
 return {method:r.method,url,headers,body:['GET','HEAD'].includes(r.method)?null:serializeBody(r,resolveValue),body_type:type,binary_bytes:[...(r.binaryBytes||[])],settings:{...effectiveRequestSettings(r),...settings},fields:entries(r.bodyFields)};
}
const requestPending=new Set(),binaryLoads=new Map();
async function send(){
 if(settingsPanel)await settingsPanel.ready;
 const id=selectedTab;if(requestPending.has(id)||!reqs().some(r=>r.id===id))return;
 sync({commitQuery:true});const sentSnapshot=cloneRequest(reqs().find(r=>r.id===id));requestPending.add(id);updateSendButton();
 try{const request=resolvedRequest(sentSnapshot),result=await invoke('send_request',{request});tabResponses[id]=result;state.history.unshift({...sentSnapshot,id:uniqueId('h'),at:Date.now(),url:request.url});state.history=state.history.slice(0,60);persist();if(selectedTab===id){sync();response=result;render()}}
 catch(error){const result={ok:false,status:'ERROR',time_ms:0,body:String(error)};tabResponses[id]=result;if(selectedTab===id){sync();response=result;render()}}
 finally{requestPending.delete(id);if(selectedTab===id)updateSendButton()}
}
function updateSendButton(){const button=$('#send');if(!button)return;const pending=requestPending.has(selectedTab);button.disabled=pending;button.textContent=pending?'Sending…':'Send';button.setAttribute('aria-busy',String(pending))}

function localizeApplication(){
 for(const node of document.querySelectorAll('.tab-title,.tree-label,.collection-head strong,#workspaceMenu,#envSelect option:not([value=""]),.env-list [data-pick-env] span,.env-rows,.response-code,.response-headers,.mock-route-item strong,.mock-route-item small,.mock-runtime-url code,.mock-card>span,.service-card strong,.git-path-label input,.workspace-name,.snippet-source,.script-preserved textarea,.unsaved-modal>p strong,.save-to strong,.history-list [data-history]>span:not(.tree-method),.save-collection>span,.save-folder>span,[data-edit-env],.mock-route-heading>strong,.mock-card>span,.service-item>span,.service-list-item>span'))node.setAttribute('data-no-translate','');
 for(const select of document.querySelectorAll('#envSelect,#serviceCollection,#serviceEnvironment,#mockCollection,#deployMockSelect,#entityDestination'))for(const option of select.options)if(option.value)option.setAttribute('data-no-translate','');
 if(typeof translateUi==='function')translateUi(document);
}
if(typeof observeUi==='function')observeUi(document.body);
function status(){invoke('git_status').then(x=>{const e=$('#gitStatus');if(e)e.textContent=x.replaceAll('\n',' ')||'Git: clean'}).catch(()=>{const e=$('#gitStatus');if(e)e.textContent='Git: not configured'})}
function effectiveRequestSettings(request){const g=appSettings.general;return {timeout:g.timeout??0,followRedirects:g.followRedirects!==false,verifySsl:g.verifySsl!==false,...(g.httpVersion?{httpVersion:g.httpVersion}:{}),...(g.maxResponseSize!==undefined?{maxResponseSize:g.maxResponseSize}:{}),...(g.disableCookies!==undefined?{disableCookies:g.disableCookies===true}:{}),...request.settings}}
function applyAppPreferences(){
 if(settingsPanel?.isOpen())$('#app').inert=true;
 const g=appSettings.general,root=document.documentElement;
 root.classList.toggle('hide-tab-icons',g.showIconsWithTabNames===false);
 document.querySelectorAll('input[list],input[data-autocomplete-list]').forEach(input=>{if(input.hasAttribute('list'))input.dataset.autocompleteList=input.getAttribute('list');if(g.variableAutocomplete===false)input.removeAttribute('list');else input.setAttribute('list',input.dataset.autocompleteList)});
}
function editorPreferences(textarea,event){
 const g=appSettings.general;
 const insert=value=>{textarea.setRangeText(value,textarea.selectionStart,textarea.selectionEnd,'end');textarea.dispatchEvent(new Event('input',{bubbles:true}))};
 if(event.type==='keydown'){
  if(event.key==='Tab'){event.preventDefault();event.stopImmediatePropagation();insert(g.editorIndentation==='tabs'?'\t':' '.repeat(g.editorTabSize||2));return}
  if(event.metaKey||event.ctrlKey||event.altKey)return;
  const pairs={'(':')','[':']','{':'}','"':'"',"'":"'"},quote=['"',"'"].includes(event.key);
  if(pairs[event.key]&&(quote?g.editorAutoCloseQuotes:g.editorAutoCloseBrackets)!==false){
   const start=textarea.selectionStart,end=textarea.selectionEnd,selected=textarea.value.slice(start,end);
   if(quote&&textarea.value[end]===event.key&&!selected){event.preventDefault();textarea.setSelectionRange(end+1,end+1);return}
   if(quote&&start>0&&/\w/.test(textarea.value[start-1]))return;
   event.preventDefault();event.stopImmediatePropagation();textarea.setRangeText(event.key+selected+pairs[event.key],start,end,'end');textarea.setSelectionRange(start+1,start+1+selected.length);textarea.dispatchEvent(new Event('input',{bubbles:true}));
  }
 }
 if(event.type==='paste'&&g.editorFormatOnPaste&&textarea.dataset.json==='true'){
  const text=event.clipboardData?.getData('text/plain');if(!text)return;const candidate=textarea.value.slice(0,textarea.selectionStart)+text+textarea.value.slice(textarea.selectionEnd);
  try{const formatted=JSON.stringify(JSON.parse(candidate),null,g.editorIndentation==='tabs'?'\t':g.editorTabSize||2);event.preventDefault();textarea.value=formatted;textarea.dispatchEvent(new Event('input',{bubbles:true}))}catch{}
 }
}
function openAppSettings(){
 if(showEnv||showSave||showImport||entityDialog||closePromptTarget||workspaceBusy||gitBusy)return;
 try{sync();settingsPanel?.open()}catch(error){toast(String(error?.message||error))}
}
async function settingsChange(next){
 const previous=appSettings;sync();appSettings=next;
 let changed=false;
 if(next.general.twoPane!==undefined&&next.general.twoPane!==previous.general.twoPane){layout.twoPane=next.general.twoPane;changed=true}
 if(next.general.swapSidebars!==undefined&&next.general.swapSidebars!==previous.general.swapSidebars){layout.sidebarSide=next.general.swapSidebars?'right':'left';changed=true}
 if(changed){saveLayout();if($('#requestCanvas'))render()}
 else if(activeTab==='Settings'&&$('#requestTimeout')){const r=reqs().find(r=>r.id===selectedTab);if(r){const effective=effectiveRequestSettings(r);$('#requestTimeout').value=effective.timeout;document.querySelectorAll('[data-setting]').forEach(input=>input.checked=effective[input.dataset.setting])}}
 applyAppPreferences();
}
async function settingsClearHistory(){sync();const snapshot=workspaceSnapshot();snapshot.history=[];cancelScheduledPersistence();await invoke('save_workspace',{workspace:snapshot,workspaceId:workspaceCatalog.find(w=>w.active)?.id});state.history=[];render()}
async function settingsResetWorkspace(){
 ensureWorkspaceSwitchable();sync();await flushPersistence(true);
 const candidate=normalizeWorkspace({collections:[],environments:[],history:[]});
 await invoke('save_workspace',{workspace:candidate,archiveCurrent:true,workspaceId:workspaceCatalog.find(w=>w.active)?.id});
 state=candidate;restoreRequestSession();tabResponses={};response=null;treeSelection=null;selectedMockId='';serviceDrafts={};mockDraft=null;render();
}
if(typeof createSettingsPanel==='function')settingsPanel=createSettingsPanel({invoke,onChange:settingsChange,
 onExport:async()=>{sync();await flushPersistence(true);const path=await invoke('export_workspace',{workspace:workspaceSnapshot()});return path},
 onImport:()=>openImport({fromSettings:true}),onClearHistory:settingsClearHistory,onReset:settingsResetWorkspace});
document.addEventListener('keydown',event=>{
 if(settingsPanel?.isOpen()&&!showImport){event.stopImmediatePropagation();return}
 if(appSettings.shortcuts.enabled===false){if(event.metaKey||event.ctrlKey)event.stopImmediatePropagation();return}
 if(!(event.metaKey||event.ctrlKey))return;
 if(showEnv||showSave||showImport||entityDialog||closePromptTarget||workspaceDialog||workspaceMenuOpen||gitReview)return;
 const key=event.key.toLowerCase();
 const actions={',':openAppSettings,'/':()=>settingsPanel?.open('shortcuts'),o:openImport,t:newRequest,w:()=>closeWorkspaceTab(selectedTab),s:openSave,l:()=>{$('#url')?.focus();$('#url')?.select()},enter:send};
 if(actions[key]&&!event.altKey){event.preventDefault();event.stopImmediatePropagation();actions[key]();return}
 if(event.shiftKey&&[']','['].includes(key)){event.preventDefault();event.stopImmediatePropagation();const index=openTabs.indexOf(selectedTab),next=(index+(key===']'?1:-1)+openTabs.length)%openTabs.length;if(openTabs[next])selectWorkspaceTab(openTabs[next]);return}
 if(/^[1-9]$/.test(key)){event.preventDefault();event.stopImmediatePropagation();const id=key==='9'?openTabs.at(-1):openTabs[Number(key)-1];if(id)selectWorkspaceTab(id)}
},true);
async function refreshWorkspaceCatalog(){const entries=await invoke('workspace_list');if(!Array.isArray(entries)||!entries.some(w=>w.active))throw Error('Invalid workspace list');workspaceCatalog=entries;const button=$('#workspaceMenu');if(button)button.innerHTML=`⌂　${esc(workspaceCatalog.find(w=>w.active)?.name||'My Workspace')}　⌄`}
async function toggleWorkspaceMenu(){
 if(workspaceBusy||gitBusy||envSaving)return;
 if(workspaceMenuOpen){workspaceMenuOpen=false;updateWorkspaceUi();return}
 try{sync();await refreshWorkspaceCatalog();workspaceMenuOpen=true;workspaceFilter='';updateWorkspaceUi();$('#workspaceSearch')?.focus()}catch(error){toast(String(error?.message||error))}
}
function updateWorkspaceUi(){
 $('#workspaceOverlay')?.remove();$('#workspaceMenu')?.setAttribute('aria-expanded',String(workspaceMenuOpen));$('#app').inert=workspaceBusy||!!settingsPanel?.isOpen();
 if(!workspaceMenuOpen&&!workspaceDialog)return;
 const overlay=document.createElement('div');overlay.id='workspaceOverlay';
 if(workspaceDialog){
  const d=workspaceDialog,deleting=d.kind==='delete';overlay.className='modal-backdrop';
  overlay.innerHTML=`<section class="entity-modal workspace-dialog" role="dialog" aria-modal="true" aria-label="${deleting?'Delete':d.kind==='create'?'Create':'Rename'} workspace"><header><strong>${deleting?'Delete workspace':d.kind==='create'?'Create workspace':'Rename workspace'}</strong><button id="closeWorkspaceDialog" aria-label="Close">${icon('close')}</button></header><div class="workspace-dialog-body">${deleting?`<p>Remove “${esc(d.name)}” from the workspace list? Its local data is archived.</p>`:`<label>Name<input id="workspaceName" maxlength="80" value="${esc(d.name)}" placeholder="Workspace name"/></label>`}<p class="save-error" id="workspaceActionError">${esc(d.error||'')}</p></div><footer><button id="cancelWorkspaceDialog">Cancel</button><button id="confirmWorkspaceAction" class="entity-primary">${deleting?'Delete':d.kind==='create'?'Create':'Save'}</button></footer></section>`;
 }else{
  overlay.className='workspace-switcher';overlay.setAttribute('role','menu');overlay.setAttribute('aria-label','Workspaces');
  overlay.innerHTML=`<header><input id="workspaceSearch" aria-label="Search workspaces" placeholder="Search workspaces…" value="${esc(workspaceFilter)}"/><button id="createWorkspace" title="Create workspace" aria-label="Create workspace">${icon('add')}</button></header><div class="workspace-options">${workspaceCatalog.filter(w=>w.name.toLowerCase().includes(workspaceFilter.toLowerCase())).map(w=>`<div class="workspace-option ${w.active?'active':''}"><button data-switch-workspace="${esc(w.id)}" role="menuitem" ${w.active?'aria-current="true"':''}><span>⌂</span><span><span class="workspace-name">${esc(w.name)}</span><small>Local workspace</small></span>${w.active?'<i>✓</i>':''}</button><button data-rename-workspace="${esc(w.id)}" aria-label="Rename ${esc(w.name)}" title="Rename"><svg class="ui-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m10 3 3 3-7 7-4 1 1-4 7-7Z M9 4l3 3" stroke="currentColor" stroke-linejoin="round"/></svg></button>${!w.active?`<button data-delete-workspace="${esc(w.id)}" aria-label="Delete ${esc(w.name)}" title="Delete"><svg class="ui-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2 4h12M6 2h4M4 4l1 10h6l1-10M7 6v6m2-6v6" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`:''}</div>`).join('')||'<p>No workspaces found</p>'}</div><footer><button id="createWorkspaceFooter">Create Workspace</button></footer>`;
 }
 document.body.append(overlay);localizeApplication();
 const close=()=>{if(!workspaceBusy){workspaceMenuOpen=false;workspaceDialog=null;updateWorkspaceUi()}};
 $('#closeWorkspaceDialog')?.addEventListener('click',close);$('#cancelWorkspaceDialog')?.addEventListener('click',close);
 const create=()=>{workspaceMenuOpen=false;workspaceDialog={kind:'create',name:''};updateWorkspaceUi();$('#workspaceName')?.focus()};
 $('#createWorkspace')?.addEventListener('click',create);$('#createWorkspaceFooter')?.addEventListener('click',create);
 $('#workspaceSearch')?.addEventListener('input',e=>{const pos=e.target.selectionStart;workspaceFilter=e.target.value;updateWorkspaceUi();$('#workspaceSearch').focus();$('#workspaceSearch').setSelectionRange(pos,pos)});
 document.querySelectorAll('[data-switch-workspace]').forEach(b=>b.onclick=()=>switchLocalWorkspace(b.dataset.switchWorkspace));
 for(const kind of ['rename','delete'])document.querySelectorAll(`[data-${kind}-workspace]`).forEach(b=>b.onclick=()=>{const id=b.dataset[kind+'Workspace'],entry=workspaceCatalog.find(w=>w.id===id);workspaceMenuOpen=false;workspaceDialog={kind,id,name:entry.name};updateWorkspaceUi();$('#workspaceName')?.focus()});
 $('#workspaceName')?.addEventListener('input',e=>{workspaceDialog.name=e.target.value});
 $('#confirmWorkspaceAction')?.addEventListener('click',performWorkspaceAction);
 for(const control of overlay.querySelectorAll('button,input'))control.disabled=workspaceBusy;
}
async function withWorkspaceOperation(operation){
 if(workspaceBusy||gitBusy||envSaving)return;workspaceBusy=true;updateWorkspaceUi();
 try{await operation()}catch(error){const message=String(error?.message||error);if(workspaceDialog)workspaceDialog.error=message;toast(message)}finally{workspaceBusy=false;updateWorkspaceUi()}
}
function ensureWorkspaceSwitchable(){
 if(requestPending.size||binaryLoads.size||mockPending.size||servicePending.size||Object.keys(mockRuntime).length||Object.values(serviceRuntime).some(r=>r.running))throw Error('Wait for requests and stop running local services before switching workspaces.');
 if(showSave||showEnv||showImport||entityDialog||closePromptTarget||gitReview)throw Error('Finish or cancel the open dialog before switching workspaces.');
}
async function switchLocalWorkspace(id){
 if(workspaceCatalog.find(w=>w.active)?.id===id){workspaceMenuOpen=false;updateWorkspaceUi();return}
 await withWorkspaceOperation(async()=>{sync();ensureWorkspaceSwitchable();await flushPersistence(true);await replaceActiveWorkspace(id);workspaceMenuOpen=false;workspaceDialog=null});
}
async function replaceActiveWorkspace(id){
 const loaded=await invoke('workspace_switch',{id});state=normalizeWorkspace(loaded);workspaceError='';cancelScheduledPersistence();restoreRequestSession();
 response=null;tabResponses={};mockRuntime={};serviceRuntime={};selectedMockId='';mockDraft=null;serviceDrafts={};treeSelection=null;treeMenu=null;sidebarFilter='';activeTab='Params';view='collections';gitPanelOutput='';gitReview=null;collectionsExpanded=true;collapsedCollections.clear();expandedFolders.clear();
 workspaceCatalog=workspaceCatalog.map(w=>({...w,active:w.id===id}));await refreshWorkspaceCatalog().catch(()=>{});render();
}
async function performWorkspaceAction(){
 const d=workspaceDialog;if(!d)return;
 await withWorkspaceOperation(async()=>{
  if(d.kind==='create'){sync();ensureWorkspaceSwitchable();await flushPersistence(true);const created=await invoke('workspace_create',{name:d.name});await replaceActiveWorkspace(created.id)}
  else await invoke(d.kind==='rename'?'workspace_rename':'workspace_delete',{id:d.id,name:d.name});
  await refreshWorkspaceCatalog();workspaceDialog=null;workspaceMenuOpen=false;
 });
}
document.addEventListener('pointerdown',event=>{if(workspaceMenuOpen&&!workspaceBusy&&!event.target.closest('#workspaceOverlay,#workspaceMenu')){workspaceMenuOpen=false;updateWorkspaceUi()}});
document.addEventListener('keydown',event=>{
 if(!workspaceMenuOpen&&!workspaceDialog&&!workspaceBusy)return;
 if(event.key==='Escape'&&!workspaceBusy){event.preventDefault();event.stopImmediatePropagation();workspaceMenuOpen=false;workspaceDialog=null;updateWorkspaceUi();$('#workspaceMenu')?.focus();return}
 if(event.metaKey||event.ctrlKey){event.preventDefault();event.stopImmediatePropagation();return}
 if(event.key==='Enter'&&workspaceDialog&&!workspaceBusy){event.preventDefault();performWorkspaceAction()}
 if(event.key==='Tab'){const dialog=$('#workspaceOverlay'),fields=[...dialog.querySelectorAll('button:not(:disabled),input:not(:disabled)')];if(!fields.length)return;const first=fields[0],last=fields.at(-1);if(event.shiftKey&&(document.activeElement===first||!dialog.contains(document.activeElement))){event.preventDefault();last.focus()}else if(!event.shiftKey&&(document.activeElement===last||!dialog.contains(document.activeElement))){event.preventDefault();first.focus()}}
},true);
function gitSidebar(){return `<div class="git-original" id="gitPanel"><h2>Work with Git</h2><p>Open a local Git working directory to share saved Collections, environments and service configurations.</p>${state.gitRepository?`<div class="git-configured"><label class="git-path-label">Working directory<input value="${esc(state.gitRepository)}" readonly/></label><div class="git-actions"><button id="gitPanelStatus">View changes</button><button id="gitPanelPull">Pull</button><button id="openGitFolder">Change Folder</button></div><label class="git-message-label">Commit message<input id="gitCommitMessage" value="${esc(gitCommitMessage)}"/></label><div class="git-actions"><button id="gitPanelCommit">Commit…</button><button id="gitPanelSync" class="git-push">Commit &amp; Push…</button></div></div>`:'<button id="openGitFolder">Open Folder</button>'}<pre id="gitPanelOutput" role="status">${esc(gitPanelOutput)}</pre></div>`}
function updateGitUi(){
 $('#app').inert=gitBusy||workspaceBusy||!!settingsPanel?.isOpen();
 const panel=$('#gitPanel');if(panel){panel.outerHTML=gitSidebar();bindGitControls()}
 $('#gitReviewBackdrop')?.remove();
 if(gitReview){
  const g=gitReview,opening=g.kind==='open',count=g.workspace?.collections?.reduce((sum,c)=>sum+(c.items?.length||0),0)||0;
  const modal=document.createElement('div');modal.id='gitReviewBackdrop';modal.className='modal-backdrop';
  modal.innerHTML=`<section class="git-review" role="dialog" aria-modal="true" aria-labelledby="gitReviewTitle"><header><strong id="gitReviewTitle">${opening?'Open Git workspace':'Review Git changes'}</strong><button id="closeGitReview" aria-label="Close">${icon('close')}</button></header><div class="git-review-body"><p>${esc(g.path)}</p>${opening?`<p>${g.workspace?`Repository contains ${g.workspace.collections.length} Collections and ${count} requests. Loading replaces your current Collections, environments and service configurations. Local history is kept, and the previous workspace is backed up.`:'No localpostman-workspace.json exists yet. Use your current workspace to create it with your first commit.'}</p><pre>${esc(g.status||'Working directory is clean')}</pre>`:`<p>Only saved workspace content is committed. Drafts and request history stay local.</p>${g.externallyChanged?'<p class="save-error">Repository workspace changed outside the app. Reopen the folder and review it before committing.</p>':''}<pre>${esc(g.status||'Working directory is clean')}</pre><pre class="git-diff">${esc(g.diff||'No workspace changes')}</pre>`}</div><footer><button id="cancelGitReview">Cancel</button>${opening?`${g.workspace?'<button id="loadGitWorkspace" class="git-primary">Load repository workspace</button>':''}<button id="keepGitWorkspace">Use current workspace</button>`:`<button id="confirmGitCommit" class="git-primary" ${g.externallyChanged?'disabled':''}>${g.push?'Commit &amp; Push':'Commit'}</button>`}</footer></section>`;
  document.body.append(modal);localizeApplication();
  $('#closeGitReview').onclick=$('#cancelGitReview').onclick=()=>{if(!gitBusy){gitReview=null;updateGitUi()}};
  $('#loadGitWorkspace')?.addEventListener('click',()=>acceptGitWorkspace(true));
  $('#keepGitWorkspace')?.addEventListener('click',()=>acceptGitWorkspace(false));
  $('#confirmGitCommit')?.addEventListener('click',()=>runGitCommit());
  if(!gitBusy)modal.querySelector('button:not(:disabled)')?.focus();
 }
 for(const button of document.querySelectorAll('#gitPanel button,#gitReviewBackdrop button,#gitConfigure,#gitSync'))button.disabled=gitBusy||(button.id==='confirmGitCommit'&&!!gitReview?.externallyChanged);
}
document.addEventListener('keydown',event=>{
 if(!gitReview&&!gitBusy)return;
 if(event.key==='Escape'&&gitReview&&!gitBusy){event.preventDefault();event.stopImmediatePropagation();gitReview=null;updateGitUi();return}
 if(event.metaKey||event.ctrlKey){event.preventDefault();event.stopImmediatePropagation();return}
 if(event.key==='Tab'&&gitReview){const dialog=$('#gitReviewBackdrop'),fields=[...dialog.querySelectorAll('button:not(:disabled)')];if(!fields.length)return;const first=fields[0],last=fields.at(-1);if(event.shiftKey&&(document.activeElement===first||!dialog.contains(document.activeElement))){event.preventDefault();last.focus()}else if(!event.shiftKey&&(document.activeElement===last||!dialog.contains(document.activeElement))){event.preventDefault();first.focus()}}
},true);
function bindGitControls(){
 $('#app').inert=gitBusy||workspaceBusy||!!settingsPanel?.isOpen();
 $('#gitConfigure').onclick=chooseGitFolder;
 $('#gitSync').onclick=()=>reviewGitCommit(true);
 $('#openGitFolder')?.addEventListener('click',chooseGitFolder);
 $('#gitCommitMessage')?.addEventListener('input',e=>{gitCommitMessage=e.target.value});
 $('#gitPanelStatus')?.addEventListener('click',()=>reviewGitCommit(null));
 $('#gitPanelPull')?.addEventListener('click',pullGitWorkspace);
 $('#gitPanelCommit')?.addEventListener('click',()=>reviewGitCommit(false));
 $('#gitPanelSync')?.addEventListener('click',()=>reviewGitCommit(true));
 if(gitBusy)for(const button of document.querySelectorAll('#gitPanel button,#gitConfigure,#gitSync'))button.disabled=true;
}
async function withGitOperation(operation){
 if(gitBusy)return;gitBusy=true;updateGitUi();
 try{await operation()}catch(error){gitPanelOutput=String(error?.message||error);toast('Git: '+gitPanelOutput)}
 finally{gitBusy=false;updateGitUi();status()}
}
async function chooseGitFolder(){
 if(gitBusy)return;
 if(!window.__TAURI_INTERNALS__){gitPanelOutput='Git operations require the desktop client.';toast(gitPanelOutput);updateGitUi();return}
 await withGitOperation(async()=>{sync();await flushPersistence(true);const path=await invoke('git_choose_folder');if(!path)return;const result=await invoke('git_open',{path});gitReview={...result,kind:'open'};gitPanelOutput=result.status});
}
async function acceptGitWorkspace(load){
 const review=gitReview;if(review?.kind!=='open')return;
 await withGitOperation(async()=>{
  sync();await flushPersistence(true);
  const latest=await invoke('git_open',{path:review.path});
  if(latest.revision!==review.revision){gitReview={...latest,kind:'open'};throw Error('Repository changed. Review its latest workspace before continuing.')}
  if(load){await loadGitWorkspace(latest)}else{
   const previous={path:state.gitRepository,revision:state.gitWorkspaceRevision};
   state.gitRepository=latest.path;state.gitWorkspaceRevision=latest.revision;
   try{await flushPersistence(true)}catch(error){state.gitRepository=previous.path;state.gitWorkspaceRevision=previous.revision;throw error}
  }
  gitReview=null;gitPanelOutput=latest.status||'Git working directory connected';
 });
}
async function loadGitWorkspace(result){
 if(!result.workspace)throw Error('Repository has no workspace file.');
 if(reqs().some(r=>isRequestDirty(r.id,r)))throw Error('Save or discard unsaved requests before loading a repository workspace.');
 if(requestPending.size||binaryLoads.size||mockPending.size||servicePending.size||Object.values(mockRuntime).some(r=>r.port)||Object.values(serviceRuntime).some(r=>r.running))throw Error('Wait for requests and stop running local services before replacing the workspace.');
 const candidate=normalizeWorkspace(cloneRequest(result.workspace));candidate.history=state.history;candidate.gitRepository=result.path;candidate.gitWorkspaceRevision=result.revision;delete candidate.editorSession;
 cancelScheduledPersistence();await invoke('save_workspace',{workspace:candidate,archiveCurrent:true,workspaceId:workspaceCatalog.find(w=>w.active)?.id});
 state=candidate;restoreRequestSession();tabResponses={};response=null;treeSelection=null;activeTab='Params';render();
}
async function reviewGitCommit(push){
 if(gitBusy)return;if(!state.gitRepository){await chooseGitFolder();return}
 await withGitOperation(async()=>{sync();await flushPersistence(true);const preview=await invoke('git_preview',{path:state.gitRepository,expectedRevision:state.gitWorkspaceRevision||null});gitPanelOutput=[preview.status,preview.diff||'No workspace changes'].join('\n\n');if(push!==null)gitReview={...preview,kind:'commit',push,localFingerprint:gitWorkspaceFingerprint(),externallyChanged:preview.externallyChanged||!state.gitWorkspaceRevision};if(preview.externallyChanged)throw Error('Repository changed outside the app. Reopen the folder to review the current workspace.');if(!state.gitWorkspaceRevision)throw Error('Reopen the Git folder to review and connect its workspace before committing.')});
}
function gitWorkspaceFingerprint(){
 const workspace=workspaceSnapshot();for(const c of workspace.collections)c.items=c.items.flatMap(r=>{const baseline=workspace.editorSession.requestBaselines[r.id];return baseline===null?[]:[baseline||r]});
 for(const key of ['history','editorSession','gitRepository','gitWorkspaceRevision'])delete workspace[key];
 return JSON.stringify(workspace);
}
async function runGitCommit(){
 const review=gitReview;if(review?.kind!=='commit'||review.externallyChanged)return;
 await withGitOperation(async()=>{
  sync();await flushPersistence(true);
  if(review.localFingerprint!==gitWorkspaceFingerprint())throw Error('Workspace changed after this preview. Cancel and review changes again before committing.');
  const result=await invoke('git_sync',{message:gitCommitMessage.trim()||'Update LocalPostman workspace',push:review.push,expectedRevision:review.revision});
  state.gitWorkspaceRevision=result.revision;await flushPersistence(true);gitReview=null;gitPanelOutput=[result.output,result.error,result.status].filter(Boolean).join('\n\n');if(result.error)toast('Git: '+result.error);
 });
}
async function pullGitWorkspace(){
 await withGitOperation(async()=>{
  sync();await flushPersistence(true);
  if(reqs().some(r=>isRequestDirty(r.id,r)))throw Error('Save or discard unsaved requests before pulling a repository workspace.');
  if(requestPending.size||binaryLoads.size||mockPending.size||servicePending.size||Object.values(mockRuntime).some(r=>r.port)||Object.values(serviceRuntime).some(r=>r.running))throw Error('Wait for requests and stop local services before pulling.');
  const result=await invoke('git_pull',{path:state.gitRepository,expectedRevision:state.gitWorkspaceRevision||null});
  await loadGitWorkspace(result);gitPanelOutput=[result.output,result.status].filter(Boolean).join('\n\n');
 });
}
async function loadWorkspace(){
 try{
  await refreshWorkspaceCatalog().catch(()=>{});
  const loaded=await invoke('load_workspace');state=normalizeWorkspace(loaded);workspaceError='';restoreRequestSession();render();
  invoke('service_status').then(items=>{for(const runtime of items)serviceRuntime[runtime.id]=runtime;if(serviceTabInfo(selectedTab))render()}).catch(()=>{});
  invoke('mock_status').then(servers=>{mockRuntime=Object.fromEntries(servers.map(server=>[server.id,server]));if(selectedTab.startsWith('mock:')||view==='services')render()}).catch(()=>{});
 }catch(error){
  const message=String(error?.message||error);
  if(message.includes('WORKSPACE_NOT_FOUND')){workspaceError='';state=normalizeWorkspace(cloneRequest(seed));restoreRequestSession();render();return}
  workspaceError=message;cancelScheduledPersistence();render();
  try{workspaceRecovery=await invoke('workspace_recovery_info');render()}catch{}
 }
}
function renderWorkspaceRecovery(){
 document.querySelector('#app').innerHTML=`<section class="workspace-recovery" role="alert"><h1>Could not open your workspace</h1><p>Your existing data has been kept. Editing is paused to prevent overwriting it.</p><pre>${esc(workspaceError)}</pre><div><button id="retryWorkspace">Retry</button>${workspaceRecovery?.backupAvailable?'<button id="restoreWorkspaceBackup">Restore last good backup</button>':''}</div><p id="recoveryError"></p></section>`;
 $('#retryWorkspace').onclick=loadWorkspace;
 $('#restoreWorkspaceBackup')?.addEventListener('click',async()=>{const button=$('#restoreWorkspaceBackup');button.disabled=true;try{state=normalizeWorkspace(await invoke('restore_workspace_backup'));workspaceError='';workspaceRecovery=null;restoreRequestSession();render()}catch(error){$('#recoveryError').textContent=String(error?.message||error);button.disabled=false}});
}
loadWorkspace();
refreshWorkspaceCatalog().catch(()=>{});
window.addEventListener('pagehide',()=>{if(persistencePending&&!workspaceError)flushPersistence()});


function snippetRequest(){return resolvedRequest(current())}
function snippetCode(){try{return generateCodeSnippet(snippetRequest(),snippetLang)}catch(e){return '// Unable to generate code: '+e.message}}
function snippetPanel(){return `<aside class="code-snippet-panel" aria-label="Code snippet"><header><h2>Code snippet</h2><button id="closeSnippet" aria-label="Close code snippet">${icon('close')}</button></header><div class="snippet-controls"><select id="snippetLanguage" aria-label="Code snippet language">${snippetLanguages.map(([id,name])=>`<option value="${id}" ${snippetLang===id?'selected':''}>${name}</option>`).join('')}</select><button id="copySnippet" title="Copy snippet">Copy</button></div><pre class="snippet-source"><code>${esc(snippetCode())}</code></pre></aside>`}
function bindSnippet(){
 const open=()=>{sync();showSnippet=!showSnippet;render()};$('#codeSnippet')?.addEventListener('click',open);
 $('#requestMore')?.addEventListener('click',()=>{if($('#requestActionsMenu')){$('#requestActionsMenu').remove();return}const menu=document.createElement('div');menu.id='requestActionsMenu';menu.className='request-actions-menu';menu.setAttribute('role','menu');menu.innerHTML='<button role="menuitem" id="openCodeSnippet">Code snippet</button>';$('#requestMore').parentElement.append(menu);$('#openCodeSnippet').onclick=()=>{sync();showSnippet=true;render()}});
 $('#closeSnippet')?.addEventListener('click',()=>{showSnippet=false;render()});$('#snippetLanguage')?.addEventListener('change',e=>{snippetLang=e.target.value;render()});$('#copySnippet')?.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(snippetCode());$('#copySnippet').textContent='Copied';setTimeout(()=>{if($('#copySnippet'))$('#copySnippet').textContent='Copy'},1500)}catch{const area=document.createElement('textarea');area.value=snippetCode();document.body.append(area);area.select();document.execCommand('copy');area.remove();toast('Copied')}});
 document.querySelector('.shell')?.classList.toggle('has-code-snippet',showSnippet&&!isMockTab()&&!!$('#requestName'));
}
