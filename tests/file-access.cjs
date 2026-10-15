const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const calls=[];
const ctx={Request,Response,encodeURIComponent,String,Set,Object,
 createClient:()=>({rpc:async(name,input)=>{calls.push(input);return {data:input.session_token==='test-session'?{ok:true,data:{privateRecord:'must-not-leak'}}:{ok:false,expired:true,error:'인증이 필요합니다.'},error:null};}}),
 holidayHandler:async()=>Response.json({year:2026,holidays:{'2026-10-09':['한글날']}}),
};
ctx.Deno={env:{get:()=>''},serve:handler=>ctx.handler=handler};
vm.createContext(ctx);
const source=fs.readFileSync('supabase/functions/rollbook-api/index.ts','utf8').replace(/^import .*;\r?\n/gm,'');
vm.runInContext(stripTypeScriptTypes(source),ctx);
const request=(origin,method='OPTIONS',action='get',token='')=>new Request('https://example.com/',{method,headers:{Origin:origin,'Content-Type':'application/json'},...(method==='POST'?{body:JSON.stringify({action,session_token:token,body:{year:2026}})}:{})});
(async()=>{
 for(const origin of ['null','https://rollbook1.netlify.app','http://127.0.0.1:8765','http://localhost:8765']){
  const r=await ctx.handler(request(origin));assert.equal(r.status,204);assert.equal(r.headers.get('access-control-allow-origin'),origin);
 }
 assert.equal(calls.length,0);
 assert.equal((await ctx.handler(request('https://not-allowed.example'))).status,403);assert.equal(calls.length,0);
 const denied=await (await ctx.handler(request('null','POST','get'))).json();assert.equal(denied.ok,false);
 const calendarDenied=await (await ctx.handler(request('null','POST','holidays'))).json();assert.equal(calendarDenied.ok,false);
 const calendar=await (await ctx.handler(request('null','POST','holidays','test-session'))).json();
 assert.equal(calendar.ok,true);assert.equal(calendar.holidays['2026-10-09'][0],'한글날');assert.equal(calendar.data,undefined);assert(!JSON.stringify(calendar).includes('must-not-leak'));assert.equal(calls.at(-1).action,'get');
 ctx.holidayHandler=async()=>Response.json({error:'자료 확인 실패'},{status:502});
 assert.equal((await (await ctx.handler(request('null','POST','holidays','test-session'))).json()).ok,false);
 console.log('PASS: file origin allowed, foreign origin blocked, unchanged session enforcement, authenticated holiday routing excludes private records');
})().catch(error=>{console.error(error);process.exitCode=1;});
