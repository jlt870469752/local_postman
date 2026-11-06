import http from 'node:http';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join, normalize, extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile); const root=fileURLToPath(new URL('.', import.meta.url)); const port=process.env.PORT||4173;
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml'};
async function body(req){let b=''; for await(const c of req)b+=c; return b;}
const server=http.createServer(async(req,res)=>{try{
 if(req.method==='POST'&&req.url==='/api/git-sync'){const data=JSON.parse(await body(req)||'{}'); const msg=data.message||'Update local requests'; await exec('git',['add','.'],{cwd:root}); let commit=''; try{commit=(await exec('git',['commit','-m',msg],{cwd:root})).stdout}catch(e){commit=e.stdout||e.message} let push=''; if(data.push){try{push=(await exec('git',['push'],{cwd:root})).stdout}catch(e){push=e.stderr||e.message}} res.writeHead(200,{'content-type':'application/json'}); res.end(JSON.stringify({ok:true,commit,push})); return;}
 if(req.method==='GET'&&req.url==='/api/git-status'){let out=''; try{out=(await exec('git',['status','--short','--branch'],{cwd:root})).stdout}catch(e){out=e.message} res.writeHead(200,{'content-type':'application/json'}); res.end(JSON.stringify({status:out})); return;}
 let pathname=decodeURIComponent(req.url.split('?')[0]); if(pathname==='/')pathname='/index.html'; const file=normalize(join(root,pathname)); if(!file.startsWith(root)){res.writeHead(403);return res.end('Forbidden')} if(!existsSync(file)){res.writeHead(404);return res.end('Not found')} res.writeHead(200,{'content-type':types[extname(file)]||'application/octet-stream'}); res.end(await readFile(file));
}catch(e){res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:e.message}))}}); server.listen(port,()=>console.log(`LocalPostman running at http://localhost:${port}`));
