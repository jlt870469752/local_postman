/** Generate source from the same resolved request passed to Tauri's HTTP command. */
export const snippetLanguages = [
  ['curl', 'cURL'],
  ['javascript-fetch', 'JavaScript - Fetch'],
  ['javascript-xhr', 'JavaScript - XHR'],
  ['node-axios', 'Node.js - Axios'],
  ['python-requests', 'Python - Requests'],
];
const quoted = value => "'" + String(value).replaceAll("'", "'\\''") + "'";
const json = value => JSON.stringify(value, null, 2);
function python(value) {
  if (value === null) return 'None';
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (Array.isArray(value)) return '[' + value.map(python).join(', ') + ']';
  if (typeof value === 'object') return '{' + Object.entries(value).map(([k, v]) => python(k) + ': ' + python(v)).join(', ') + '}';
  return JSON.stringify(value);
}
function linesWithFlags(args) { return args.map((v, i) => (i ? '  ' : '') + v).join(' \\\n'); }
export function generateCodeSnippet(request, language = 'curl') {
  const method = request.method || 'GET', url = request.url || '';
  const headers = Array.isArray(request.headers) ? request.headers : Object.entries(request.headers || {});
  const type = request.body_type || 'raw', fields = request.fields || [], bytes = request.binary_bytes || [];
  const hasBody = !['GET', 'HEAD'].includes(method.toUpperCase());
  const body = hasBody ? request.body : null;
  const timeout = request.settings?.timeout;
  if (language === 'curl') {
    const args = ['curl --request ' + quoted(method), '--url ' + quoted(url)];
    for (const [key, value] of headers) args.push('--header ' + quoted(key + ': ' + value));
    if (hasBody && type === 'form-data') for (const [key, value] of fields) args.push('--form-string ' + quoted(key + '=' + value));
    else if (hasBody && type === 'binary') args.push('--data-binary @-');
    else if (body !== null && body !== undefined) args.push('--data-raw ' + quoted(body));
    if (request.settings?.followRedirects !== false) args.push('--location');
    if (request.settings?.verifySsl === false) args.push('--insecure');
    if (timeout > 0) args.push('--max-time ' + Number(timeout / 1000));
    const command = linesWithFlags(args);
    return hasBody && type === 'binary' ? "printf '%b' " + quoted(bytes.map(n => '\\0' + Number(n).toString(8).padStart(3, '0')).join('')) + ' | ' + command : command;
  }
  if (language === 'python-requests') {
    const parts = ['import requests', '', 'url = ' + python(url), 'headers = ' + python(Object.fromEntries(headers))];
    const duplicates = headers.length !== new Set(headers.map(([k]) => k.toLowerCase())).size;
    if (duplicates) parts.push('# requests merges duplicate header names; use cURL to preserve separate header lines.');
    let bodyArg = '';
    if (hasBody && type === 'form-data') { parts.push('files = ' + '[' + fields.map(([k,v]) => '(' + python(k) + ', (None, ' + python(v) + '))').join(', ') + ']'); bodyArg = ', files=files'; }
    else if (hasBody && type === 'binary') { parts.push('payload = bytes(' + python(bytes) + ')'); bodyArg = ', data=payload'; }
    else if (body !== null && body !== undefined) { parts.push('payload = ' + python(body)); bodyArg = ', data=payload.encode("utf-8")'; }
    const settings = ', allow_redirects=' + python(request.settings?.followRedirects !== false) + ', verify=' + python(request.settings?.verifySsl !== false) + (timeout > 0 ? ', timeout=' + Number(timeout / 1000) : '');
    parts.push('', 'response = requests.request(' + python(method) + ', url, headers=headers' + bodyArg + settings + ')', 'print(response.status_code)', 'print(response.text)');
    return parts.join('\n');
  }
  const parts = [];
  let bodyValue;
  if (hasBody && type === 'form-data') { parts.push('const body = new FormData();', ...fields.map(([k,v]) => 'body.append(' + JSON.stringify(k) + ', ' + JSON.stringify(v) + ');'), ''); bodyValue = 'body'; }
  else if (hasBody && type === 'binary') bodyValue = 'new Uint8Array(' + JSON.stringify(bytes) + ')';
  else if (body !== null && body !== undefined) bodyValue = JSON.stringify(body);
  if (language === 'javascript-fetch') {
    const options = ['  method: ' + JSON.stringify(method), '  headers: ' + json(headers).replaceAll('\n', '\n  '), '  redirect: ' + JSON.stringify(request.settings?.followRedirects === false ? 'manual' : 'follow')];
    if (bodyValue) options.push('  body: ' + bodyValue);
    if (timeout > 0) options.push('  signal: AbortSignal.timeout(' + Number(timeout) + ')');
    return parts.concat('const response = await fetch(' + JSON.stringify(url) + ', {', options.join(',\n'), '});', 'console.log(response.status);', 'console.log(await response.text());').join('\n');
  }
  if (language === 'javascript-xhr') {
    parts.push('const xhr = new XMLHttpRequest();', 'xhr.open(' + JSON.stringify(method) + ', ' + JSON.stringify(url) + ');');
    for (const [k,v] of headers) parts.push('xhr.setRequestHeader(' + JSON.stringify(k) + ', ' + JSON.stringify(v) + ');');
    if (timeout > 0) parts.push('xhr.timeout = ' + Number(timeout) + ';');
    parts.push('xhr.onload = () => console.log(xhr.status, xhr.responseText);', 'xhr.onerror = () => console.error("Network error");', 'xhr.send(' + (bodyValue || 'null') + ');');
    return parts.join('\n');
  }
  if (language === 'node-axios') {
    parts.unshift('import axios from "axios";', '');
    const config = ['  method: ' + JSON.stringify(method), '  url: ' + JSON.stringify(url), '  headers: ' + json(Object.fromEntries(headers)).replaceAll('\n', '\n  ')];
    if (bodyValue) config.push('  data: ' + bodyValue);
    if (timeout > 0) config.push('  timeout: ' + Number(timeout));
    if (request.settings?.followRedirects === false) config.push('  maxRedirects: 0');
    if (request.settings?.verifySsl === false) { parts.unshift('import https from "node:https";'); config.push('  httpsAgent: new https.Agent({ rejectUnauthorized: false })'); }
    parts.push('const response = await axios({', config.join(',\n'), '});', 'console.log(response.status);', 'console.log(response.data);');
    return parts.join('\n');
  }
  throw new Error('Unsupported snippet language: ' + language);
}
