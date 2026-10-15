const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {once} = require('node:events');
const {projectId, healthPath} = require('../tools/local.cjs');
const address='http://127.0.0.1:8765';
const root=path.resolve(__dirname,'..');
function launch(){
  const child=spawn(process.execPath,[path.join(root,'tools/local.cjs'),'--no-open'],{cwd:root,windowsHide:true});
  let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);
  return {child, output:()=>output, closed:once(child,'close')};
}
async function waitFor(check){
  const end=Date.now()+8000;
  while(Date.now()<end){if(await check())return;await new Promise(resolve=>setTimeout(resolve,80));}
  throw Error('Local server readiness timed out');
}
(async()=>{
  // Never terminate a server that was already running before this test.
  let occupied=false;
  try {await fetch(address,{signal:AbortSignal.timeout(800)});occupied=true;}catch{}
  if(occupied) throw Error('Port 8765 is already in use. Test did not stop it.');
  const first=launch();
  try {
    await waitFor(async()=>{try{return (await (await fetch(address+healthPath)).json()).projectId===projectId;}catch{return false;}});
    assert.equal(await (await fetch(address)).text(),fs.readFileSync(path.join(root,'index.html'),'utf8'));
    assert.equal((await fetch(address+'/supabase_security.sql')).status,404);
    assert.equal((await fetch(address,{method:'POST'})).status,404);
    const second=launch();
    assert.equal((await second.closed)[0],0);
    assert.match(second.output(),/already running/);
    assert.equal(first.child.exitCode,null);
    console.log('PASS: real HTML, private-file/write route blocking, second launch reuses the same server');
  } finally {first.child.kill();await first.closed;}
  const foreign=http.createServer((req,res)=>res.end(JSON.stringify({app:'rollbook-local',projectId:'different-project'})));
  await new Promise((resolve,reject)=>foreign.once('error',reject).listen(8765,'127.0.0.1',resolve));
  try {
    const rejected=launch();
    assert.equal((await rejected.closed)[0],1);
    assert.match(rejected.output(),/different server/);
    assert.equal((await fetch(address)).status,200);
    console.log('PASS: another project using the port is preserved and never reused');
  } finally {await new Promise(resolve=>foreign.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
