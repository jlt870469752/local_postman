import { setLanguage, translateUi } from './i18n.js';

const copy = value => JSON.parse(JSON.stringify(value));
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

export const defaultSettings = {
  general: { language: 'en', httpVersion: 'auto', timeout: 0, maxResponseSize: 50, verifySsl: true, sslKeyLog: false, sslKeyLogPath: '', disableCookies: false, responseFormat: 'auto', workingDirectory: '', readOutsideWorkingDirectory: false, sendNoCacheHeader: false, sendPostmanTokenHeader: false, followRedirects: true, redirectWithOriginalMethod: false, followAuthorizationHeader: false, maxRedirects: 10, requestValidation: true, trimKeysAndValues: false, variableAutocomplete: true, alwaysAskClosingUnsavedTabs: true, showIconsWithTabNames: true, twoPane: false, swapSidebars: false, editorFontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', editorFontSize: 12, editorTabSize: 2, editorIndentation: 'spaces', editorAutoCloseBrackets: true, editorAutoCloseQuotes: true, editorLineWrap: true, editorFormatOnPaste: false },
  theme: { mode: 'light', accent: 'orange' }, shortcuts: { enabled: true },
  certificates: { caEnabled: false, caPath: '', clients: [] },
  proxy: { useSystem: true, enabled: false, type: 'http', host: '', port: 8080, username: '', password: '', bypass: '' },
  update: { automaticCheck: false },
};
// These monospace fonts are available in the macOS desktop build.
const fontChoices = [
  ['ui-monospace, SFMono-Regular, Menlo, monospace', 'System default'],
  ['Menlo, Monaco, monospace', 'Menlo'],
  ['Monaco, Menlo, monospace', 'Monaco'],
  ['Courier New, monospace', 'Courier New'],
];
export function normalizeSettings(value = {}) {
  const normalized = Object.fromEntries(Object.entries(defaultSettings).map(([key, defaults]) => [key, { ...copy(defaults), ...(value[key] || {}) }]));
  normalized.general.language = normalized.general.language === 'zh-CN' ? 'zh-CN' : 'en';
  const legacyFont = { 'Menlo': 'Menlo, Monaco, monospace', 'Menlo, monospace': 'Menlo, Monaco, monospace', 'Monaco': 'Monaco, Menlo, monospace', 'Monaco, monospace': 'Monaco, Menlo, monospace', 'Courier New': 'Courier New, monospace' }[normalized.general.editorFontFamily];
  if (legacyFont) normalized.general.editorFontFamily = legacyFont;
  if (!fontChoices.some(([value]) => value === normalized.general.editorFontFamily)) normalized.general.editorFontFamily = defaultSettings.general.editorFontFamily;
  return normalized;
}
const paths = {
  general: '<path d="m6 2 .5-1h3L10 2l1.4.8 1.1-.1 1.5 2.6-.6 1 .1 1.6.6 1-1.5 2.6-1.2-.1-1.4.8-.5 1h-3l-.5-1-1.4-.8-1.1.1L2 8.9l.6-1-.1-1.6-.6-1 1.5-2.6 1.2.1L6 2Z"/><circle cx="8" cy="7" r="2.2"/>',
  themes: '<path d="M13.8 8a5.8 5.8 0 1 0-5.8 5.8c1 0 1.3-.9.8-1.5-.6-.8-.1-1.7 1-1.7h1.4c1.5 0 2.6-1 2.6-2.6Z"/><circle cx="4.7" cy="6" r=".5"/><circle cx="7.2" cy="3.7" r=".5"/><circle cx="10.5" cy="4.6" r=".5"/>',
  shortcuts: '<rect x="1.5" y="3" width="13" height="10" rx="1.4"/><path d="M4 6h1m2 0h1m2 0h1m-7 3h1m2 0h1m2 0h1m-6 2h5"/>',
  data: '<path d="M3 1.8h8l2 2V14H3Z M5 2v4h5V2M5 10h6v4"/>',
  certificates: '<path d="M2 1.8h9v7M2 1.8v12h5M4 4h5M4 6h3"/><circle cx="10.8" cy="9" r="2.4"/><path d="m9 11-1 3 2.8-1 2.7 1-1-3"/>',
  proxy: '<rect x="2" y="2" width="12" height="4" rx=".5"/><rect x="2" y="10" width="12" height="4" rx=".5"/><path d="M4 4h2m-2 8h2m2-6v4"/>',
  update: '<path d="M2 3v11h12V3M8 1v10m-4-4 4 4 4-4"/>',
  about: '<circle cx="8" cy="8" r="6"/><path d="M8 7v5m0-8v.2"/>',
};
const icon = name => `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true">${paths[name] || ''}</svg>`;
const sections = [['general', 'General'], ['themes', 'Themes'], ['shortcuts', 'Shortcuts'], ['data', 'Data'], ['certificates', 'Certificates'], ['proxy', 'Proxy'], ['update', 'Update'], ['about', 'About']];
const shortcuts = [['Send request', '⌘ Enter'], ['Save request', '⌘ S'], ['Create new request', '⌘ T'], ['Close current tab', '⌘ W'], ['Switch to next tab', '⇧ ⌘ ]'], ['Switch to previous tab', '⇧ ⌘ ['], ['Switch to tab at position', '⌘ 1 through ⌘ 8'], ['Switch to last tab', '⌘ 9'], ['Import', '⌘ O'], ['Open settings', '⌘ ,'], ['Toggle left sidebar', '⌘ \\'], ['Two-pane response view', '⌥ ⌘ V'], ['Swap sidebar side', '⌥ ⌘ S'], ['Reset layout', '⌥ ⌘ R'], ['Beautify JSON body', '⇧ ⌘ B']];

export function createSettingsPanel({ invoke, onChange = () => {}, onExport, onImport, onClearHistory, onReset, onShortcuts = () => {} } = {}) {
  if (typeof invoke !== 'function') throw Error('Settings require an invoke function');
  let saved = normalizeSettings(), draft = copy(saved), section = 'general', overlay = null, timer = null, version = 0, dirty = false, loaded = false, loadError = '', error = '', notice = '', saving = false, info = null, pendingConfirmation = null, priorFocus = null, priorInert = false, actionBusy = false;
  let chain = Promise.resolve(), childDialogOpen = false;
  const invalidFields = new Map();
  const $ = selector => overlay?.querySelector(selector);
  const get = path => path.split('.').reduce((value, key) => value?.[key], draft);
  const set = (path, value) => { const keys = path.split('.'), name = keys.pop(), target = keys.reduce((obj, key) => obj[key], draft); target[name] = value; };
  const media = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function applyAppearance(settings = draft) {
    if (typeof setLanguage === 'function') setLanguage(settings.general?.language || 'en');
    const mode = settings.theme?.mode || 'light', dark = mode === 'dark' || (mode === 'system' && !!media?.matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.documentElement.style.setProperty('--settings-accent', ({ orange: '#ff6c37', blue: '#3478dc', purple: '#7656ce', green: '#278455' })[settings.theme?.accent] || '#ff6c37');
    document.documentElement.style.setProperty('--editor-font-family', settings.general?.editorFontFamily || defaultSettings.general.editorFontFamily);
    document.documentElement.style.setProperty('--editor-font-size', `${settings.general?.editorFontSize || 12}px`);
    document.documentElement.style.setProperty('--editor-tab-size', String(settings.general?.editorTabSize || 2));
    document.documentElement.dataset.editorWrap = settings.general?.editorLineWrap === false ? 'off' : 'on';
    onShortcuts(settings.shortcuts?.enabled !== false);
    if (typeof translateUi === 'function') translateUi(document);
  }
  media?.addEventListener?.('change', () => { if (draft.theme.mode === 'system') applyAppearance(); });
  function message() { const label = $('#settingsSaveState'); if (label) { label.textContent = error || notice || (saving ? 'Saving…' : dirty ? 'Unsaved changes' : 'All changes saved'); label.className = error ? 'settings-error' : 'settings-save-state'; } const button = $('#settingsRetrySave'); if (button) { button.hidden = !dirty; button.disabled = saving; } if (overlay && typeof translateUi === 'function') translateUi(overlay); }
  function markChanged(path, value) {
    invalidFields.delete(path); set(path, value); version++; dirty = true; error = ''; notice = '';
    if (path === 'general.language' || path.startsWith('theme.') || path.startsWith('general.editor') || path.startsWith('shortcuts.')) applyAppearance();
    clearTimeout(timer); timer = setTimeout(() => { timer = null; flush().catch(() => {}); }, 300); message();
  }
  async function flush() {
    clearTimeout(timer); timer = null;
    if (!loaded) throw Error(loadError || 'Settings have not loaded');
    if (invalidFields.size) { error = 'Enter a valid ' + invalidFields.keys().next().value.split('.').at(-1) + ' value.'; message(); throw Error(error); }
    if (!dirty) { await chain; return; }
    const snapshot = copy(draft), snapshotVersion = version;
    const operation = chain.catch(() => {}).then(async () => {
      saving = true; message();
      try {
        const result = await invoke('settings_save', { settings: snapshot });
        saved = normalizeSettings(result || snapshot);
        if (version === snapshotVersion) { draft = copy(saved); dirty = false; error = ''; }
        await onChange(copy(saved)); applyAppearance(dirty ? draft : saved);
      } catch (failure) {
        error = 'Could not save settings: ' + String(failure?.message || failure); applyAppearance(saved); throw failure;
      } finally { saving = false; message(); }
    });
    chain = operation; chain.catch(() => {}); return operation;
  }
  const ready = (async () => {
    try { saved = normalizeSettings(await invoke('settings_load')); draft = copy(saved); loaded = true; applyAppearance(saved); await onChange(copy(saved)); }
    catch (failure) { loadError = String(failure?.message || failure); error = 'Could not load settings: ' + loadError; }
  })();
  function toggle(path, label, disabled = false) { return `<label class="settings-toggle" aria-label="${escapeHtml(label)}"><input type="checkbox" role="switch" data-preference="${path}" ${get(path) ? 'checked' : ''} ${disabled ? 'disabled' : ''}/><span></span></label>`; }
  function input(path, { type = 'number', min = 0, max, unit = '', placeholder = '' } = {}) { return `<div class="settings-input-unit"><input type="${type}" aria-label="${escapeHtml(path.split('.').pop())}" data-preference="${path}" value="${escapeHtml(invalidFields.has(path) ? invalidFields.get(path) : get(path))}" ${type === 'number' ? `min="${min}" ${max != null ? `max="${max}"` : ''}` : ''} placeholder="${escapeHtml(placeholder)}" ${type === 'password' ? 'autocomplete="off"' : ''}/>${unit ? `<span>${unit}</span>` : ''}</div>`; }
  function select(path, choices) { return `<select aria-label="${escapeHtml(path.split('.').pop())}" data-preference="${path}">${choices.map(([value, label]) => `<option value="${escapeHtml(value)}" ${get(path) === value ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}</select>`; }
  const fontSelect = () => select('general.editorFontFamily', fontChoices);
  function row(title, description, control, extra = '') { return `<div class="settings-row ${extra}"><div class="settings-row-description"><div class="settings-label">${title}</div>${description ? `<p>${description}</p>` : ''}</div><div class="settings-row-control">${control}</div></div>`; }
  const heading = name => `<h3>${name}</h3>`;
  function pathChooser(path, kind, label) { return `<div class="settings-path"><input readonly value="${escapeHtml(get(path))}" aria-label="${escapeHtml(label)}" placeholder="Not selected"/><button data-choose-path="${path}" data-path-kind="${kind}">Choose</button>${get(path) ? `<button class="settings-clear-path" data-clear-path="${path}" aria-label="Clear ${escapeHtml(label)}">Clear</button>` : ''}</div>`; }
  function general() {
    return heading('Request') +
      row('HTTP version', 'Select the HTTP version to use for sending the request.', select('general.httpVersion', [['auto', 'Auto'], ['http1', 'HTTP/1.x'], ['http2', 'HTTP/2']])) +
      row('Request timeout', 'Set how long a request should wait for a response before timing out. To never time out, set to 0.', input('general.timeout', { unit: 'ms', max: 86400000 })) +
      row('Max response size', 'Set the maximum size of a response to download. To download a response of any size, set to 0.', input('general.maxResponseSize', { unit: 'MB', max: 10240 })) +
      row('SSL certificate verification', '', toggle('general.verifySsl', 'SSL certificate verification')) +
      row('SSL/TLS key log', 'Unavailable with the native TLS engine used by this build.', toggle('general.sslKeyLog', 'SSL/TLS key log', true)) +
      (get('general.sslKeyLog') ? row('Key log file', 'Choose the local file for the session key log.', pathChooser('general.sslKeyLogPath', 'sslKeyLog', 'TLS key log file'), 'settings-row-stacked') : '') +
      row('Disable cookies', 'Disable the cookie jar for all requests.', toggle('general.disableCookies', 'Disable cookies')) +
      row('Response format detection', '', `<div class="settings-radio-group">${[['auto','Auto'],['json','JSON']].map(([value,label]) => `<label><input type="radio" name="settings-response-format" data-preference="general.responseFormat" value="${value}" ${get('general.responseFormat') === value ? 'checked' : ''}/> ${label}</label>`).join('')}</div>`) +
      heading('Working directory') + `<p class="settings-section-note">Choose the directory used by the working-directory file picker. The explicit Select file picker can still open files you choose.</p>` +
      row('Location', '', pathChooser('general.workingDirectory', 'directory', 'Working directory'), 'settings-row-stacked') +
      row('Read files outside working directory', 'Allow explicitly selected request files outside the working directory.', toggle('general.readOutsideWorkingDirectory', 'Read files outside working directory')) +
      heading('Headers') +
      row('Send no-cache header', 'Send Cache-Control: no-cache with requests unless a header is already set.', toggle('general.sendNoCacheHeader', 'Send no-cache header')) +
      row('Send Postman Token header', 'Add a unique Postman-Token header to each request.', toggle('general.sendPostmanTokenHeader', 'Send Postman Token header')) +
      heading('Request behavior') +
      row('Automatically follow redirects', '', toggle('general.followRedirects', 'Automatically follow redirects')) +
      row('Follow original HTTP method', 'Keep the original request method when following a redirect.', toggle('general.redirectWithOriginalMethod', 'Follow original HTTP method')) +
      row('Follow Authorization header', 'Forward the Authorization header when a redirect changes the host.', toggle('general.followAuthorizationHeader', 'Follow Authorization header')) +
      row('Maximum number of redirects', '', input('general.maxRedirects', { max: 100 })) +
      row('Request validation', 'Validate the HTTP method and request URL before sending.', toggle('general.requestValidation', 'Request validation')) +
      row('Trim keys and values', 'Remove leading and trailing whitespace from query parameters and headers when sending.', toggle('general.trimKeysAndValues', 'Trim keys and values')) +
      heading('User interface') +
      row('Always ask when closing unsaved tabs', 'Ask whether to save changes before closing a request tab.', toggle('general.alwaysAskClosingUnsavedTabs', 'Always ask when closing unsaved tabs')) +
      row('Show icons with tab names', '', toggle('general.showIconsWithTabNames', 'Show icons with tab names')) +
      row('Two-pane view', 'Place the request and response side by side.', toggle('general.twoPane', 'Two-pane view')) +
      row('Swap left and right sidebars', '', toggle('general.swapSidebars', 'Swap left and right sidebars')) +
      row('Variable autocomplete', 'Show available variables while editing requests.', toggle('general.variableAutocomplete', 'Variable autocomplete')) +
      heading('Editor settings') +
      row('Font family', '', fontSelect()) +
      row('Font size', '', input('general.editorFontSize', { min: 8, max: 32, unit: 'px' })) +
      row('Tab size', '', select('general.editorTabSize', [[2,'2'],[4,'4'],[8,'8']])) +
      row('Indentation', '', select('general.editorIndentation', [['spaces','Spaces'],['tabs','Tabs']])) +
      row('Automatically close brackets', '', toggle('general.editorAutoCloseBrackets', 'Automatically close brackets')) +
      row('Automatically close quotes', '', toggle('general.editorAutoCloseQuotes', 'Automatically close quotes')) +
      row('Line wrapping', '', toggle('general.editorLineWrap', 'Line wrapping')) +
      row('Format JSON on paste', '', toggle('general.editorFormatOnPaste', 'Format JSON on paste')) +
      heading('Application') +
      row('Language', 'Choose the language used for menus, settings and messages.', `<div class="settings-radio-group">${[['en','English'],['zh-CN','简体中文']].map(([value,label]) => `<label data-no-translate><input type="radio" name="settings-language" data-preference="general.language" value="${value}" ${get('general.language') === value ? 'checked' : ''}/> ${label}</label>`).join('')}</div>`);
  }
  function themes() {
    return `<p class="settings-section-note">Choose how LocalPostman looks on this device.</p><div class="settings-theme-options">${[['light','Light'],['dark','Dark'],['system','System']].map(([value,label]) => `<label class="settings-theme-option ${get('theme.mode') === value ? 'selected' : ''}"><input type="radio" name="settings-theme" data-preference="theme.mode" value="${value}" ${get('theme.mode') === value ? 'checked' : ''}/><div class="settings-theme-preview ${value}"><i></i><span></span><b></b></div><strong>${label}</strong></label>`).join('')}</div>` + heading('Accent color') + `<div class="settings-accent-options">${[['orange','#ff6c37'],['blue','#3478dc'],['purple','#7656ce'],['green','#278455']].map(([value,color])=>`<label style="--swatch:${color}" title="${value}"><input type="radio" name="settings-accent" data-preference="theme.accent" value="${value}" ${get('theme.accent') === value ? 'checked' : ''}/><span>${get('theme.accent') === value ? '✓' : ''}</span><small>${value[0].toUpperCase()+value.slice(1)}</small></label>`).join('')}</div>`;
  }
  function shortcutsContent() { return row('Keyboard shortcuts', 'Enable application keyboard shortcuts. Editing keys inside text fields stay available.', toggle('shortcuts.enabled', 'Keyboard shortcuts')) + `<div class="settings-shortcut-list">${shortcuts.map(([label,key])=>`<div><span>${label}</span><kbd>${key}</kbd></div>`).join('')}</div>`; }
  function confirmation() { return pendingConfirmation ? `<div class="settings-confirmation" role="alert"><strong>${pendingConfirmation === 'history' ? 'Clear request history?' : 'Reset current workspace?'}</strong><p>${pendingConfirmation === 'history' ? 'Remove the request history in the current workspace. Collections and environments are kept.' : 'Remove Collections, environments, request tabs and service configurations from the current workspace. Export a backup before continuing.'}</p><div><button id="settingsCancelAction" ${actionBusy ? 'disabled' : ''}>Cancel</button><button id="settingsConfirmAction" class="settings-danger" ${actionBusy ? 'disabled' : ''}>${pendingConfirmation === 'history' ? 'Clear history' : 'Reset workspace'}</button></div></div>` : ''; }
  function data() {
    return heading('Import and export') +
      row('Export data', 'Save the current local workspace to a JSON file, including Collections and environments.', `<button id="settingsExport" ${onExport && !actionBusy ? '' : 'disabled'}>Export Data</button>`) +
      row('Import data', 'Import cURL, a Postman Collection or environment, or a local workspace JSON file.', `<button id="settingsImport" ${onImport ? '' : 'disabled'}>Import Data</button>`) +
      heading('Local data') + row('Clear request history', 'Clear history in the current workspace.', `<button id="settingsClearHistory" ${onClearHistory ? '' : 'disabled'}>Clear history</button>`) +
      row('Reset workspace', 'Reset the current workspace after creating a local recovery copy.', `<button id="settingsReset" class="settings-danger" ${onReset ? '' : 'disabled'}>Reset workspace</button>`) + confirmation();
  }
  function certificates() {
    const clients = draft.certificates.clients || [];
    return heading('CA certificates') + row('Use custom CA certificates', 'Trust an additional PEM or CRT certificate bundle when verifying HTTPS responses.', toggle('certificates.caEnabled', 'Use custom CA certificates')) + row('CA certificate file', '', pathChooser('certificates.caPath', 'ca', 'CA certificate file'), 'settings-row-stacked') +
      `<div class="settings-section-heading"><h3>Client certificates</h3><button id="settingsAddCertificate">Add Certificate</button></div><p class="settings-section-note">Attach a client certificate only to requests matching its host and port.</p>` +
      (clients.length ? clients.map((cert,index)=>`<section class="settings-certificate-card"><header><strong ${cert.host ? 'data-no-translate' : ''}>${escapeHtml(cert.host || 'New certificate')}</strong><button data-remove-certificate="${index}" aria-label="Remove certificate ${index+1}">Remove</button></header><div class="settings-certificate-grid"><label>Host<input data-certificate="${index}" data-field="host" value="${escapeHtml(cert.host)}" placeholder="api.example.com"/></label><label>Port<input type="number" min="0" max="65535" data-certificate="${index}" data-field="port" value="${escapeHtml(invalidFields.get('certificates.clients.'+index+'.port') ?? cert.port ?? 443)}"/></label></div>${row('CRT or PFX/P12 file', 'PEM/CRT requires an unencrypted PKCS#8 key. PFX/P12 uses its passphrase.', `<div class="settings-path"><input readonly aria-label="Certificate file ${index+1}" value="${escapeHtml(cert.certPath)}" placeholder="Not selected"/><button data-certificate-path="${index}" data-field="certPath" data-path-kind="certificate">Choose</button></div>`, 'settings-row-stacked')}${row('KEY file', '', `<div class="settings-path"><input readonly aria-label="Private key file ${index+1}" value="${escapeHtml(cert.keyPath)}" placeholder="Not selected"/><button data-certificate-path="${index}" data-field="keyPath" data-path-kind="privateKey">Choose</button></div>`, 'settings-row-stacked')}<label class="settings-certificate-passphrase">Passphrase<input type="password" autocomplete="off" data-certificate="${index}" data-field="passphrase" value="${escapeHtml(cert.passphrase)}" placeholder="Optional"/></label></section>`).join('') : '<div class="settings-empty">No client certificates configured</div>');
  }
  function proxy() {
    return heading('Proxy configuration') + row('Use system proxy', 'Use the proxy configuration available to the desktop HTTP runtime.', toggle('proxy.useSystem', 'Use system proxy')) +
      row('Use custom proxy configuration', 'Route HTTP requests through the proxy below.', toggle('proxy.enabled', 'Use custom proxy configuration')) +
      `<div class="settings-proxy-fields ${get('proxy.enabled') ? '' : 'settings-fields-muted'}">${row('Proxy type', '', select('proxy.type', [['http','HTTP'],['https','HTTPS'],['socks5','SOCKS5']]))}${row('Proxy server', '', input('proxy.host', {type:'text',placeholder:'127.0.0.1'}))}${row('Port', '', input('proxy.port', {min:1,max:65535}))}${row('Username', '', input('proxy.username',{type:'text'}))}${row('Password', '', input('proxy.password',{type:'password'}))}${row('Proxy bypass', 'Comma-separated hosts or domains that should connect directly, such as localhost, 127.0.0.1, .example.com.', input('proxy.bypass',{type:'text',placeholder:'localhost, 127.0.0.1'}))}</div>`;
  }
  function update() { return heading('Updates') + row('Automatically check for updates', 'A signed release feed has not been configured for this development build.', toggle('update.automaticCheck', 'Automatically check for updates', true)) + `<div class="settings-update-card"><strong>LocalPostman ${escapeHtml(info?.version || '0.2.0')}</strong><p>Updates are checked against the release source configured for this client.</p><button id="settingsCheckUpdate">Check for Updates</button><p id="settingsUpdateResult" role="status"></p></div>`; }
  function about() { return `<div class="settings-about-mark">L<span>↗</span></div><h3>LocalPostman</h3><p class="settings-section-note">A local API client built with Tauri and Rust.</p><dl class="settings-about-details">${[['Version',info?.version || '…'],['Platform',info ? `${info.platform} (${info.arch})` : '…'],['Local data',info?.dataDirectory || '…'],['Preferences',info?.preferencesPath || '…']].map(([label,value])=>`<dt>${label}</dt><dd data-no-translate>${escapeHtml(value)}</dd>`).join('')}</dl><button id="settingsOpenData" ${info?.dataDirectory ? '' : 'disabled'}>Open data folder</button><p class="settings-section-note">Collections and preferences stay on your computer. Workspace sharing uses your Git repository.</p>`; }
  function content() { return ({ general, themes, shortcuts: shortcutsContent, data, certificates, proxy, update, about })[section](); }
  function render() {
    if (!overlay) return;
    const scrollTop = $('.settings-content')?.scrollTop || 0;
    const active = overlay.contains(document.activeElement) ? document.activeElement : null;
    const focusKey = active?.id ? `#${active.id}` : active?.dataset.preference ? `[data-preference="${active.dataset.preference}"]${active.type === 'radio' ? `[value="${active.value}"]` : ''}` : active?.dataset.certificate ? `[data-certificate="${active.dataset.certificate}"][data-field="${active.dataset.field}"]` : null;
    const selection = active?.type === 'text' || active?.type === 'password' ? [active.selectionStart, active.selectionEnd] : null;
    overlay.innerHTML = `<section class="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settingsTitle"><nav class="settings-navigation" aria-label="Settings categories">${sections.map(([id,label])=>`<button data-settings-section="${id}" class="${section===id?'selected':''}" aria-current="${section===id?'page':'false'}">${icon(id)}<span>${label}</span></button>`).join('')}</nav><div class="settings-main"><header><h2 id="settingsTitle">${sections.find(([id])=>id===section)[1]}</h2><button id="settingsClose" class="settings-close" aria-label="Close settings"><svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m3 3 14 14M17 3 3 17"/></svg></button></header><div class="settings-content">${loaded ? content() : `<div class="settings-load-error"><p>${escapeHtml(loadError || 'Loading settings…')}</p>${loadError ? '<button id="settingsRetryLoad">Retry</button>' : ''}</div>`}</div><footer class="settings-footer"><span id="settingsSaveState" role="status"></span><button id="settingsRetrySave" ${dirty ? '' : 'hidden'}>Save changes</button></footer></div></section>`;
    $('.settings-content').scrollTop = scrollTop;
    bind(); message();
    if (focusKey) { const next = $(focusKey); next?.focus(); if (selection) next?.setSelectionRange?.(...selection); }
  }
  async function runAction(action, fallback) {
    if (!action || actionBusy) return;
    actionBusy = true; render();
    try { const result = await action(); notice = result === null ? '' : typeof result === 'string' ? result : fallback; error = ''; pendingConfirmation = null; }
    catch (failure) { error = String(failure?.message || failure); }
    finally { actionBusy = false; render(); }
  }
  async function choosePath(path, kind, clientIndex, field) {
    try { const result=await invoke('settings_choose_path',{kind}); if (!result) return; if(clientIndex!=null) { draft.certificates.clients[clientIndex][field]=result; version++;dirty=true;await flush(); } else { markChanged(path,result); await flush(); } render(); }
    catch(failure){error=String(failure?.message||failure);render();}
  }
  async function refreshInfo() { try { info=await invoke('settings_info'); if(overlay&&['about','update'].includes(section))render(); } catch(failure){error='Could not read application information: '+String(failure?.message||failure);message();} }
  function bind() {
    $('#settingsClose').onclick=()=>close();
    overlay.querySelectorAll('[data-settings-section]').forEach(button=>button.onclick=()=>{section=button.dataset.settingsSection;pendingConfirmation=null;render();$('.settings-content').scrollTop=0;});
    overlay.querySelectorAll('[data-preference]').forEach(control=>{
      control.addEventListener(control.matches('input[type="text"],input[type="password"],input[type="number"]')?'input':'change',()=>{
        if(control.type==='radio'&&!control.checked)return;
        let value=control.type==='checkbox'?control.checked:control.type==='number'?Number(control.value):control.value;
        if(control.tagName==='SELECT'&&control.dataset.preference==='general.editorTabSize')value=Number(value);
        if(control.type==='number'&&(!control.value||!Number.isFinite(value)||!Number.isInteger(value)||value<Number(control.min||0)||(control.max&&value>Number(control.max)))){invalidFields.set(control.dataset.preference,control.value);version++;dirty=true;error='Enter a valid '+control.getAttribute('aria-label')+' value.';clearTimeout(timer);timer=null;message();return;}
        markChanged(control.dataset.preference,value);
        if(control.dataset.preference==='general.sslKeyLog'||control.dataset.preference.startsWith('theme.'))render();
      });
    });
    $('#settingsRetrySave').onclick=()=>flush().then(()=>render()).catch(()=>{});
    $('#settingsRetryLoad')?.addEventListener('click',async()=>{try{saved=normalizeSettings(await invoke('settings_load'));draft=copy(saved);invalidFields.clear();loaded=true;loadError='';error='';applyAppearance(saved);await onChange(copy(saved));render()}catch(failure){loadError=String(failure?.message||failure);render()}});
    overlay.querySelectorAll('[data-choose-path]').forEach(button=>button.onclick=()=>choosePath(button.dataset.choosePath,button.dataset.pathKind));
    overlay.querySelectorAll('[data-clear-path]').forEach(button=>button.onclick=()=>{markChanged(button.dataset.clearPath,'');render()});
    $('#settingsExport')?.addEventListener('click',()=>runAction(onExport,'Workspace exported.'));
    $('#settingsImport')?.addEventListener('click',async()=>{
      if(childDialogOpen||actionBusy||!onImport)return;
      childDialogOpen=true;overlay.inert=true;
      try {
        if(dirty||saving)await flush();
        await onImport();
      } catch(failure){error=String(failure?.message||failure);message()}
      finally {childDialogOpen=false;if(overlay){overlay.inert=false;$('#settingsImport')?.focus()}}
    });
    $('#settingsClearHistory')?.addEventListener('click',()=>{pendingConfirmation='history';render()});
    $('#settingsReset')?.addEventListener('click',()=>{pendingConfirmation='reset';render()});
    $('#settingsCancelAction')?.addEventListener('click',()=>{pendingConfirmation=null;render()});
    $('#settingsConfirmAction')?.addEventListener('click',()=>runAction(pendingConfirmation==='history'?onClearHistory:onReset,pendingConfirmation==='history'?'History cleared.':'Workspace reset.'));
    $('#settingsAddCertificate')?.addEventListener('click',()=>{draft.certificates.clients.push({id:'cert-'+Date.now().toString(36)+Math.random().toString(36).slice(2,6),host:'',port:443,certPath:'',keyPath:'',passphrase:''});version++;dirty=true;render()});
    overlay.querySelectorAll('[data-certificate]').forEach(control=>control.addEventListener('input',()=>{const path='certificates.clients.'+control.dataset.certificate+'.'+control.dataset.field;const value=control.type==='number'?Number(control.value):control.value;if(control.type==='number'&&(!control.value||!Number.isInteger(value)||value<0||value>65535)){invalidFields.set(path,control.value);version++;dirty=true;error='Enter a valid certificate port (0–65535).';clearTimeout(timer);timer=null;message();return;}invalidFields.delete(path);draft.certificates.clients[Number(control.dataset.certificate)][control.dataset.field]=value;version++;dirty=true;error='';clearTimeout(timer);timer=setTimeout(()=>flush().catch(()=>{}),300);message()}));
    overlay.querySelectorAll('[data-certificate-path]').forEach(button=>button.onclick=()=>choosePath(null,button.dataset.pathKind,Number(button.dataset.certificatePath),button.dataset.field));
    overlay.querySelectorAll('[data-remove-certificate]').forEach(button=>button.onclick=()=>{draft.certificates.clients.splice(Number(button.dataset.removeCertificate),1);for(const path of invalidFields.keys()){if(path.startsWith('certificates.clients.'))invalidFields.delete(path)}version++;dirty=true;render();flush().catch(()=>{})});
    $('#settingsCheckUpdate')?.addEventListener('click',async()=>{const button=$('#settingsCheckUpdate');button.disabled=true;try{const result=await invoke('settings_check_update');$('#settingsUpdateResult').textContent=result.message||result.status}catch(failure){$('#settingsUpdateResult').textContent=String(failure?.message||failure)}finally{button.disabled=false}});
    $('#settingsOpenData')?.addEventListener('click',()=>runAction(()=>invoke('settings_open_path',{path:info.dataDirectory}),'Opened data folder.'));
  }
  async function open(nextSection='general') {
    await ready;
    section=sections.some(([id])=>id===nextSection)?nextSection:'general';pendingConfirmation=null;
    if(!overlay){priorFocus=document.activeElement;const app=document.getElementById('app');priorInert=app?.inert||false;if(app)app.inert=true;overlay=document.createElement('div');overlay.className='settings-backdrop';overlay.id='settingsPanel';document.body.append(overlay);}
    render();$('#settingsClose')?.focus();refreshInfo();
  }
  async function close() {
    if(!overlay)return true;
    if(actionBusy||childDialogOpen)return false;
    try { if(dirty||saving)await flush(); }
    catch { return false; }
    overlay.remove();overlay=null;const app=document.getElementById('app');if(app)app.inert=priorInert;priorFocus?.focus?.();return true;
  }
  document.addEventListener('keydown',event=>{
    if(!overlay||childDialogOpen)return;
    if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();if(actionBusy)return;if(pendingConfirmation){pendingConfirmation=null;render()}else close();return;}
    if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='s'){event.preventDefault();event.stopImmediatePropagation();flush().catch(()=>{});return;}
    if(event.key==='Tab'){const controls=[...overlay.querySelectorAll('button:not(:disabled):not([hidden]),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)')];if(!controls.length)return;const first=controls[0],last=controls.at(-1);if(event.shiftKey&&(document.activeElement===first||!overlay.contains(document.activeElement))){event.preventDefault();last.focus()}else if(!event.shiftKey&&(document.activeElement===last||!overlay.contains(document.activeElement))){event.preventDefault();first.focus()}}
  },true);
  return { open, close, getSettings:()=>copy(saved), ready, applyAppearance, flush, isOpen:()=>!!overlay };
}
