// 개발 미리보기 전용. 실제 수파베이스에 요청하지 않는다.
// 이 파일은 배포용 index.html에 포함하지 않는다.
(() => {
  let state, revision=1, serial=1;
  const accounts=[{id:'master',username:'master',password:'master1234',role:'master'},
    {id:'adm_001',username:'admin',password:'1234',role:'general',memo:'기본 담당자',createdAt:'2026-10-12'}];
  const sessions=new Map();
  const feedback=[];
  const copy=x=>JSON.parse(JSON.stringify(x));
  const clean=a=>{const {password,...rest}=a;return rest;};
  window.supabase={createClient(){return {functions:{async invoke(name,{body:args}){
    const {action,session_token:token,body}=args;
    const ok=x=>({data:{ok:true,...x}}),fail=error=>({data:{ok:false,error}});
    if(action==='status')return ok({secure:true});
    state??=copy(DEFAULT_DATA);
    if(action==='login'){
      const a=accounts.find(a=>!a.disabled&&a.role===body.role&&a.username===body.username&&a.password===body.password);
      if(!a)return fail('아이디 또는 비밀번호가 맞지 않습니다.');
      const newToken='demo-'+serial++;sessions.delete(token);sessions.set(newToken,{account:a,scope:a.role==='master'?'master':body.destination==='management'?'management':'attendance'});
      return ok({token:newToken,account:clean(a)});
    }
    const s=sessions.get(token);if(!s)return fail('다시 로그인해 주세요.');
    if(action==='logout'){sessions.delete(token);return ok();}
    if(action==='attendance'){s.scope='attendance';return ok();}
    if(action.startsWith('feedback_')){
      if(s.account.role!=='master' && s.scope!=='management')return fail('담당자 인증 후 이용해 주세요.');
      const owned=feedback.filter(f=>s.account.role==='master'||f.author_id===s.account.id);
      if(action==='feedback_list')return ok({items:copy(owned).reverse()});
      if(action==='feedback_count')return ok({count:feedback.filter(f=>f.author_id===s.account.id&&f.response_version>f.seen_version).length});
      if(action==='feedback_create'){
        if(s.account.role!=='general')return fail('담당자만 의견을 보낼 수 있습니다.');
        if(!body.title?.trim()||body.title.length>100||!body.content?.trim()||body.content.length>5000)return fail('제목과 내용을 확인해 주세요.');
        const id='feedback-'+serial++;
        feedback.push({id,author_id:s.account.id,author:s.account.username,title:body.title.trim(),content:body.content.trim(),status:'접수',reply:'',response_version:0,seen_version:0,created_at:new Date().toISOString(),updated_at:new Date().toISOString()});
        return ok({id});
      }
      const item=owned.find(f=>f.id===body.id);if(!item)return fail('의견을 찾을 수 없습니다.');
      if(action==='feedback_read'){
        if(item.author_id===s.account.id)item.seen_version=Math.max(item.seen_version,Math.min(item.response_version,body.version||0));return ok();
      }
      if(action==='feedback_reply'){
        if(s.account.role!=='master')return fail('관리자만 답변할 수 있습니다.');
        if(body.version!==item.response_version)return fail('답변이 변경됐습니다. 목록을 다시 열어주세요.');
        if(!['접수','완료','보류','불가'].includes(body.status)||!body.reply?.trim()||body.reply.length>5000)return fail('상태와 답변을 입력해 주세요.');
        Object.assign(item,{reply:body.reply.trim(),status:body.status,response_version:item.response_version+1,updated_at:new Date().toISOString()});return ok();
      }
      return fail('지원하지 않는 요청입니다.');
    }
    if(action==='get'){return ok({data:{...copy(state),adminPassword:undefined,orgSecurityCode:undefined,_revision:revision,
      masterAccount:s.account.role==='master'?clean(s.account):{},generalAdmins:s.account.role==='master'?accounts.filter(a=>a.role==='general'&&!a.disabled).map(clean):[]}});}
    if(action==='save'){
      if(body._revision!==revision)return fail('다른 기기에서 자료가 변경됐습니다.');
      if(s.scope==='attendance'){
        for(const p of body.programs){
          const old=state.programs.find(x=>x.id===p.id);
          for(const [key,record] of Object.entries(p.records||{})){
            if(!old || !['attended','absent'].includes(record.status) ||
              !old.participants.some(pt=>old.sessions.some(session=>key===pt.id+'_'+session.id)))return fail('출석 기록 형식이 올바르지 않습니다.');
          }
        }
        for(const p of body.programs){const old=state.programs.find(x=>x.id===p.id);if(old)old.records={...old.records,...copy(p.records)};}
      }else state=copy(body);
      return ok({revision:++revision});
    }
    if(action==='change_password'){
      if(s.account.password!==body.current)return fail('현재 비밀번호가 맞지 않습니다.');
      s.account.password=body.password;if(body.username)s.account.username=body.username;return ok();
    }
    if(s.account.role!=='master')return fail('관리자 인증이 필요합니다.');
    if(action==='account_save'){
      if(accounts.some(a=>a.username===body.username&&a.id!==body.id))return fail('이미 사용 중인 아이디입니다.');
      let a=accounts.find(a=>a.id===body.id);if(!a){a={id:'adm_'+serial++,role:'general',createdAt:'2026-10-12 12:00:00'};accounts.push(a);}
      a.username=body.username;a.memo=body.memo;if(body.password)a.password=body.password;return ok();
    }
    if(action==='account_archive'){const a=accounts.find(a=>a.id===body.id);if(a)a.disabled=true;return ok();}
    return fail('지원하지 않는 요청입니다.');
  }}}}};
})();
