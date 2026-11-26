// Pure Postman Collection v2/v2.1 parser. It performs no file or network I/O.
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
    if (!auth || auth.type === 'noauth') return auth ? { type: 'No Auth' } : null;
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
    if (Array.isArray(node.response) && node.response.length) r.examples = node.response.filter(ex => ex && typeof ex === 'object').map(ex => ({ name: ex.name || '', status: ex.status, code: ex.code, body: ex.body || '', headers: headerRows(ex.header) }));
    items.push(r);
  });
  walk(root.item, null, normalizeAuth(root.auth));
  return { collection: { id: makeId('c'), name: root.info.name || 'Imported collection', description: describe(root.info.description), variables, folders, items, ...scriptsOf(root.event) }, warnings };
}
