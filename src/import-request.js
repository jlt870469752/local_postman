// Parse a command as data only. Never invoke a shell or read curl @file paths.
export function shellWords(source) {
  source = source.replace(/\\\r?\n/g, '');
  const words = []; let word = '', quote = '', started = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quote === "'") { if (ch === "'") quote = ''; else word += ch; continue; }
    if (ch === '"') { quote = quote === '"' ? '' : '"'; started = true; continue; }
    if (!quote && ch === "'") { quote = "'"; started = true; continue; }
    if (ch === '\\') {
      const next = source[++i]; if (next === undefined) throw Error('Incomplete escape at end of command');
      if (quote === '"' && !['$', '`', '"', '\\', '\n'].includes(next)) word += '\\';
      word += next; started = true; continue;
    }
    if (!quote && /\s/.test(ch)) { if (started) words.push(word); word = ''; started = false; continue; }
    if (!quote && /[|;&<>`]/.test(ch)) throw Error('Shell pipelines, redirects and chained commands cannot be imported');
    word += ch; started = true;
  }
  if (quote) throw Error('Unclosed quote in cURL command');
  if (started) words.push(word);
  return words;
}
const row = (key, value) => ({ key, value, enabled: true, description: '' });
export function parseCurl(source) {
  const args = shellWords(source.trim());
  if (!/^(?:curl|curl\.exe)$/i.test(args.shift() || '')) throw Error('Paste a command starting with curl');
  let url = '', method = '', get = false, head = false, bodyType = 'none', body = '', rawFormat = 'Text';
  const headers = [], fields = [], data = [], warnings = [], settings = {};
  let auth;
  const take = (inline, i, option) => { if (inline !== undefined) return [inline, i]; if (i + 1 >= args.length) throw Error(`Missing value for ${option}`); return [args[i + 1], i + 1]; };
  const textOnly = value => { if (value.startsWith('@')) throw Error('cURL @file references require an explicit file selection; no file was read'); return value; };
  for (let i = 0; i < args.length; i++) {
    let option = args[i], inline;
    if (option.startsWith('--') && option.includes('=')) { const at = option.indexOf('='); inline = option.slice(at + 1); option = option.slice(0, at); }
    else if (/^-[XHduFbAoem]/.test(option) && option.length > 2) { inline = option.slice(2); option = option.slice(0, 2); }
    const value = () => { const result = take(inline, i, option); i = result[1]; return result[0]; };
    switch (option) {
      case '-X': case '--request': method = value().toUpperCase(); break;
      case '--url': if (url) throw Error('Import one URL per request'); url = value(); break;
      case '-H': case '--header': { const h = value(); const at = h.indexOf(':'); if (at <= 0) throw Error(`Invalid header: ${h}`); headers.push(row(h.slice(0, at).trim(), h.slice(at + 1).trim())); break; }
      case '-d': case '--data': case '--data-raw': case '--data-binary': { const v = value(); data.push(option === '--data-raw' ? v : textOnly(v)); bodyType = 'raw'; break; }
      case '--json': data.push(textOnly(value())); bodyType = 'raw'; rawFormat = 'JSON'; if (!headers.some(h => h.key.toLowerCase() === 'content-type')) headers.push(row('Content-Type', 'application/json')); if (!headers.some(h => h.key.toLowerCase() === 'accept')) headers.push(row('Accept', 'application/json')); break;
      case '--data-urlencode': { const v = textOnly(value()); const at = v.indexOf('='); if (at < 0 && v.includes('@')) throw Error('cURL file-backed fields require a file selection'); data.push(at < 0 ? encodeURIComponent(v) : v.slice(0, at) + '=' + encodeURIComponent(v.slice(at + 1))); bodyType = 'urlencoded'; break; }
      case '-F': case '--form': case '--form-string': { const v = value(); const at = v.indexOf('='); if (at <= 0) throw Error('Form fields must use name=value'); const content = v.slice(at + 1); if (option !== '--form-string' && /^[@<]/.test(content)) throw Error('File upload fields require an explicit file selection'); fields.push(row(v.slice(0, at), content)); bodyType = 'form-data'; break; }
      case '-u': case '--user': { const v = value(), at = v.indexOf(':'); auth = { type: 'Basic Auth', username: at < 0 ? v : v.slice(0, at), password: at < 0 ? '' : v.slice(at + 1) }; break; }
      case '-b': case '--cookie': { const v = textOnly(value()); if (!v.includes('=')) throw Error('Cookie files cannot be imported as text'); headers.push(row('Cookie', v)); break; }
      case '-A': case '--user-agent': headers.push(row('User-Agent', value())); break;
      case '-e': case '--referer': headers.push(row('Referer', value())); break;
      case '-G': case '--get': get = true; break;
      case '-I': case '--head': head = true; break;
      case '-L': case '--location': settings.followRedirects = true; break;
      case '-k': case '--insecure': settings.verifySsl = false; break;
      case '-m': case '--max-time': { const seconds = Number(value()); if (!Number.isFinite(seconds) || seconds < 0) throw Error('Invalid cURL timeout'); settings.timeout = seconds * 1000; break; }
      case '--compressed': case '--silent': case '-s': case '--show-error': case '-S': case '--verbose': case '-v': case '--globoff': case '-g': break;
      case '--http1.1': case '--http2': warnings.push(`${option}: HTTP version selection is not supported yet`); break;
      case '--': if (i + 2 !== args.length || url) throw Error('Import one URL per request'); url = args[++i]; break;
      default: if (option.startsWith('-')) throw Error(`Unsupported cURL option: ${option}`); if (url) throw Error('Import one URL per request'); url = option;
    }
  }
  if (!url || !/^(?:https?:\/\/|\{\{)/i.test(url)) throw Error('A valid HTTP URL or {{variable}} URL is required');
  if (fields.length && data.length) throw Error('Cannot combine multipart form fields and raw data');
  body = data.join('&');
  const contentType = headers.find(h => h.key.toLowerCase() === 'content-type')?.value || '';
  if (/json/i.test(contentType)) rawFormat = 'JSON';
  if (/application\/x-www-form-urlencoded/i.test(contentType) && bodyType === 'raw') bodyType = 'urlencoded';
  if (get && data.length) { const hash = url.indexOf('#'), fragment = hash < 0 ? '' : url.slice(hash); if (hash >= 0) url = url.slice(0, hash); url += (url.includes('?') ? '&' : '?') + body + fragment; body = ''; bodyType = 'none'; }
  if (bodyType === 'urlencoded') fields.push(...Array.from(new URLSearchParams(body), ([k, v]) => row(k, v)));
  if (bodyType === 'raw' && rawFormat === 'Text' && !contentType && data.length) headers.push(row('Content-Type', 'application/x-www-form-urlencoded'));
  method = method || (head ? 'HEAD' : get ? 'GET' : data.length || fields.length ? 'POST' : 'GET');
  if (!/^[!#$%&'*+.^_`|~\w-]+$/.test(method)) throw Error('Invalid HTTP method');
  const query = url.split('?')[1]?.split('#')[0] || '';
  return { method, url, headers, params: Array.from(new URLSearchParams(query), ([k, v]) => row(k, v)), body, bodyType, bodyFields: fields, rawFormat, auth: auth || { type: 'No Auth' }, settings, warnings };
}
