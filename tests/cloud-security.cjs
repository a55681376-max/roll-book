const fs=require('fs'),assert=require('assert/strict');
const html=fs.readFileSync('index.html','utf8');
const config=html.match(/const DEFAULT_SUPABASE_CONFIG = \{\s*url: "([^"]+)",\s*anonKey: "([^"]+)"/);
if(!config)throw Error('Missing publishable config');
const base=config[1],key=config[2];
const headers={apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'};
(async()=>{
 const request=async(action,token='')=>{
  const r=await fetch(base+'/functions/v1/rollbook-api',{method:'POST',headers,body:JSON.stringify({action,session_token:token,body:{}})});
  assert.equal(r.status,200);return r.json();
 };
 assert.equal((await request('status')).secure,true);
 assert.equal((await request('get')).ok,false);assert.equal((await request('get','bad-token')).ok,false);
 const read=await fetch(base+'/rest/v1/attendance_data?select=id',{headers});assert.equal(read.status,403);
 const direct=await fetch(base+'/rest/v1/rpc/rollbook_api',{method:'POST',headers,body:JSON.stringify({action:'status',session_token:'',body:{}})});assert.equal(direct.status,403);
 console.log('PASS: deployed server API, anonymous/invalid session rejection, direct table/RPC access blocked');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
