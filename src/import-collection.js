// Collection parsers perform no file or network I/O and never execute imported scripts.
export function parseCollection(input, makeId) {
  if (input && typeof input.name === 'string' && Array.isArray(input.folders) && Array.isArray(input.requests)) {
    return parsePostmanCollection(hoppscotchToPostman(input), makeId);
  }
  return parsePostmanCollection(input, makeId);
}

function hoppscotchToPostman(root) {
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  const text = value => typeof value === 'string' ? value.replace(/<<([^<>]+)>>/g, '{{$1}}') : value ?? '';
  const rows = (value, label) => {
    if (value == null) return [];
    if (!Array.isArray(value) || value.some(row => !object(row))) throw Error(`Hoppscotch ${label} must be an array of objects`);
    return value.map(row => ({ ...row, key: text(row.key), value: text(row.value), disabled: row.active === false || row.disabled === true }));
  };
  const authOf = auth => {
    if (auth == null) return undefined;
    if (!object(auth)) throw Error('Hoppscotch auth must be an object');
    if (auth.authActive === false || auth.authType === 'none') return { type: 'noauth' };
    if (auth.authType === 'inherit') return undefined;
    const fields = keys => keys.map(key => ({ key, value: text(auth[key]) }));
    if (auth.authType === 'bearer') return { type: 'bearer', bearer: fields(['token']) };
    if (auth.authType === 'basic') return { type: 'basic', basic: fields(['username', 'password']) };
    if (auth.authType === 'api-key' || auth.authType === 'apikey') return { type: 'apikey', apikey: [...fields(['key', 'value']), { key: 'in', value: /query/i.test(auth.addTo || '') ? 'query' : 'header' }] };
    return { type: auth.authType || 'unknown' };
  };
  const eventsOf = node => [['prerequest', node.preRequestScript], ['test', node.testScript]]
    .filter(([, code]) => typeof code === 'string' && code)
    .map(([listen, code]) => ({ listen, script: { exec: code.split('\n') } }));
  const headersOf = (inherited, own) => {
    const overrides = new Set(own.map(row => String(row.key).toLowerCase()));
    return [...inherited.filter(row => !overrides.has(String(row.key).toLowerCase())), ...own];
  };
  const bodyOf = (body, headers) => {
    if (body == null) return undefined;
    if (!object(body)) throw Error('Hoppscotch body must be an object');
    const contentType = body.contentType, value = body.body;
    if (value == null && !contentType) return undefined;
    const mime = String(contentType || '').split(';')[0].trim().toLowerCase();
    // Preserve the declared MIME type, including parameters, for raw payloads.
    if (contentType && mime !== 'multipart/form-data' && !headers.some(row => !row.disabled && String(row.key).toLowerCase() === 'content-type')) {
      headers.push({ key: 'Content-Type', value: text(contentType) });
    }
    if (mime === 'multipart/form-data') {
      const fields = rows(value, 'multipart fields').map(row => ({ ...row, type: row.isFile ? 'file' : 'text', ...(row.isFile ? { src: row.value } : {}) }));
      return { mode: 'formdata', formdata: fields };
    }
    if (value != null && typeof value !== 'string') throw Error('Hoppscotch raw body must be a string');
    const language = /(?:\/|\+)json$/.test(mime) ? 'json' : ({ 'application/javascript': 'javascript', 'text/javascript': 'javascript', 'text/html': 'html', 'application/xml': 'xml', 'text/xml': 'xml' }[mime] || 'text');
    // Some exports declare urlencoded while storing arbitrary text. Keep the
    // payload verbatim instead of decoding and re-encoding it as form rows.
    return { mode: 'raw', raw: text(value), options: { raw: { language } } };
  };
  const requestOf = (node, inheritedHeaders) => {
    if (!object(node) || typeof node.endpoint !== 'string') throw Error('Hoppscotch requests must contain an endpoint string');
    const endpoint = text(node.endpoint), headers = headersOf(inheritedHeaders, rows(node.headers, 'headers'));
    const query = endpoint.split('#')[0].split('?').slice(1).join('?');
    const params = [...Array.from(new URLSearchParams(query), ([key, value]) => ({ key, value })), ...rows(node.params, 'params')];
    return { name: node.name || 'Imported request', description: node.description || '', event: eventsOf(node), request: {
      method: node.method || 'GET', url: { raw: endpoint, query: params }, header: headers,
      auth: authOf(node.auth), variable: rows(node.requestVariables, 'request variables'), body: bodyOf(node.body, headers),
    } };
  };
  const folderOf = (node, inheritedHeaders = []) => {
    if (!object(node) || typeof node.name !== 'string' || !node.name.trim() || !Array.isArray(node.folders) || !Array.isArray(node.requests)) throw Error('Hoppscotch collections and folders require name, folders and requests');
    const headers = headersOf(inheritedHeaders, rows(node.headers, 'headers'));
    return { name: node.name, description: node.description || '', auth: authOf(node.auth), variable: rows(node.variables, 'variables'), event: eventsOf(node),
      item: [...node.folders.map(folder => folderOf(folder, headers)), ...node.requests.map(request => requestOf(request, headers))] };
  };
  const normalized = folderOf(root);
  return { info: { name: normalized.name, description: normalized.description }, item: normalized.item, auth: normalized.auth, variable: normalized.variable, event: normalized.event };
}

export function parsePostmanCollection(input, makeId = (() => { let n = 0; return p => `${p}-${Date.now().toString(36)}-${++n}`; })()) {
  if (!input || typeof input !== 'object') throw new Error('Collection JSON must be an object');
  const root = input.collection && input.collection.info ? input.collection : input;
  if (!root.info || typeof root.info !== 'object' || typeof root.info.name !== 'string' || !root.info.name.trim() || !Array.isArray(root.item)) throw new Error('Expected a Postman Collection v2 or v2.1 JSON file');
  const folders = [], items = [], warnings = [];
  const list = value => Array.isArray(value) ? value : [];
  const describe = value => typeof value === 'string' ? value : value?.content || '';
  const variableRows = value => list(value).filter(v => v?.key).map(v => ({ key: v.key, value: v.value ?? '', enabled: v.disabled !== true, description: describe(v.description) }));
  const variables = variableRows(root.variable);
  const normalizeAuth = auth => {
    if (!auth || auth.type === 'noauth') return { type: 'No Auth' };
    const map = { bearer: 'Bearer Token', basic: 'Basic Auth', apikey: 'API Key' };
    const type = map[auth.type]; if (!type) { warnings.push(`Unsupported auth type: ${auth.type}`); return { type: auth.type }; }
    const values = Object.fromEntries(list(auth[auth.type]).filter(x => x?.key).map(x => [x.key, x.value ?? '']));
    return { type, ...values, location: values.in || 'header' };
  };
  const urlFrom = raw => {
    if (typeof raw === 'string') return raw;
    if (!raw || typeof raw !== 'object') return '';
    if (raw.raw) return raw.raw;
    const protocol = raw.protocol ? raw.protocol + '://' : '';
    const host = Array.isArray(raw.host) ? raw.host.join('.') : (raw.host || '');
    const port = raw.port ? ':' + raw.port : '';
    const path = Array.isArray(raw.path) ? '/' + raw.path.join('/') : (raw.path ? '/' + String(raw.path).replace(/^\//, '') : '');
    const query = Array.isArray(raw.query) ? raw.query.filter(q => q?.disabled !== true && q?.key).map(q => encodeURIComponent(q.key) + (q.value == null ? '' : '=' + encodeURIComponent(q.value))).join('&') : '';
    return protocol + host + port + path + (query ? '?' + query : '');
  };
  const rows = values => list(values).filter(x => x?.key).map(x => ({ key: x.key, value: x.value ?? '', enabled: x.disabled !== true, description: describe(x.description) }));
  const headerRows = value => typeof value === 'string' ? value.split(/\r?\n/).filter(line => line.includes(':')).map(line => { const at = line.indexOf(':'); return { key: line.slice(0, at).trim(), value: line.slice(at + 1).trim(), enabled: true, description: '' }; }) : rows(value);
  const queryRows = (url, renderedUrl) => {
    if (Array.isArray(url?.query)) return rows(url.query);
    const query = renderedUrl.split('#')[0].split('?').slice(1).join('?');
    return Array.from(new URLSearchParams(query), ([key, value]) => ({ key, value, enabled: true, description: '' }));
  };
  const scriptsOf = events => {
    const scripts = {};
    for (const event of list(events)) {
      if (!event || event.disabled || event.script?.disabled) continue;
      const code = Array.isArray(event.script?.exec) ? event.script.exec.join('\n') : event.script?.exec;
      if (typeof code !== 'string' || !code) continue;
      const key = event.listen === 'test' ? 'tests' : event.listen === 'prerequest' ? 'preRequestScript' : null;
      if (key) scripts[key] = [scripts[key], code].filter(Boolean).join('\n');
    }
    if (Object.keys(scripts).length && !warnings.includes('Scripts were imported as text and are not executed')) warnings.push('Scripts were imported as text and are not executed');
    return scripts;
  };
  const bodyOf = body => {
    if (!body) return { bodyType: 'none', body: '', bodyFields: [] };
    if (body.mode === 'raw') return { bodyType: 'raw', body: body.raw || '', rawFormat: body.options?.raw?.language ? ({ json: 'JSON', javascript: 'JavaScript', html: 'HTML', xml: 'XML' }[String(body.options.raw.language).toLowerCase()] || 'Text') : 'Text', bodyFields: [] };
    if (body.mode === 'urlencoded') return { bodyType: 'urlencoded', body: '', bodyFields: rows(body.urlencoded) };
    if (body.mode === 'formdata') {
      const fields = list(body.formdata).filter(x => x?.key).map(original => {
        const field = rows([original])[0];
        return original.type === 'file' ? { ...field, type: 'file', src: original.src || '', enabled: false } : field;
      });
      if (list(body.formdata).some(x => x?.type === 'file')) warnings.push('Form-data file fields were disabled because local files were not read');
      return { bodyType: 'form-data', body: '', bodyFields: fields };
    }
    if (body.mode === 'graphql') return { bodyType: 'graphql', body: '', graphqlQuery: body.graphql?.query || '', graphqlVariables: typeof body.graphql?.variables === 'string' ? body.graphql.variables : JSON.stringify(body.graphql?.variables || {}, null, 2), bodyFields: [] };
    if (body.mode === 'file') { warnings.push('Binary file path was not read'); return { bodyType: 'binary', body: '', binaryName: body.file?.src || '', bodyFields: [] }; }
    if (body.mode) warnings.push(`Unsupported body mode: ${body.mode}`);
    return { bodyType: 'none', body: '', bodyFields: [] };
  };
  const walk = (list, parentId = null, inheritedAuth = null) => (list || []).forEach(node => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) throw new Error('Collection items must be objects');
    if (Array.isArray(node.item)) { const id = makeId('f'); folders.push({ id, name: node.name || 'Folder', parentId, description: describe(node.description), variables: variableRows(node.variable), ...scriptsOf(node.event) }); walk(node.item, id, node.auth == null ? inheritedAuth : normalizeAuth(node.auth)); return; }
    const req = typeof node.request === 'string' ? { url: node.request } : (node.request || {});
    const id = makeId('r'), b = bodyOf(req.body), url = urlFrom(req.url);
    const r = { id, name: node.name || 'Imported request', folderId: parentId, method: req.method || 'GET', url, params: queryRows(req.url, url), headers: headerRows(req.header), description: describe(req.description || node.description), auth: req.auth == null ? inheritedAuth : normalizeAuth(req.auth), ...b, ...scriptsOf(node.event) };
    if (Array.isArray(req.variable)) r.variables = variableRows(req.variable);
    if (Array.isArray(node.response) && node.response.length) r.examples = node.response.filter(ex => ex && typeof ex === 'object').map(ex => ({ name: ex.name || '', status: ex.status, code: ex.code, body: ex.body || '', headers: headerRows(ex.header) }));
    items.push(r);
  });
  walk(root.item, null, normalizeAuth(root.auth));
  return { collection: { id: makeId('c'), name: root.info.name || 'Imported collection', description: describe(root.info.description), variables, folders, items, ...scriptsOf(root.event) }, warnings };
}
