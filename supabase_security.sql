-- 기존 테이블과 자료를 삭제하지 않는 전자출석부 보안 전환.
-- 원본을 먼저 보관하고 비밀번호는 서버 전용 테이블에 해시로 저장한다.
CREATE SCHEMA IF NOT EXISTS rollbook_private;
REVOKE ALL ON SCHEMA rollbook_private FROM PUBLIC, anon, authenticated;
CREATE TABLE IF NOT EXISTS rollbook_private.accounts (
  id text PRIMARY KEY, username text UNIQUE NOT NULL,
  role text NOT NULL CHECK (role IN ('master','general')),
  password_hash text NOT NULL, memo text NOT NULL DEFAULT '',
  created_at text NOT NULL, disabled boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS rollbook_private.sessions (
  token_hash text PRIMARY KEY, account_id text NOT NULL REFERENCES rollbook_private.accounts(id),
  version integer NOT NULL, scope text NOT NULL, expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS rollbook_private.login_limits (
  username text NOT NULL, role text NOT NULL, attempts integer NOT NULL DEFAULT 0,
  window_start timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(username,role)
);
CREATE TABLE IF NOT EXISTS rollbook_private.state_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  saved_at timestamptz NOT NULL DEFAULT now(), reason text NOT NULL, payload jsonb NOT NULL
);
ALTER TABLE rollbook_private.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE rollbook_private.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE rollbook_private.login_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE rollbook_private.state_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA rollbook_private FROM PUBLIC,anon,authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA rollbook_private FROM PUBLIC,anon,authenticated;

-- 최초 원본을 보존한다. 재실행해도 기존 계정을 덮어쓰지 않는다.
INSERT INTO rollbook_private.state_history(reason,payload)
SELECT '보안 전환 전 원본',payload FROM public.attendance_data
WHERE id='main_attendance_state'
  AND NOT EXISTS(SELECT 1 FROM rollbook_private.state_history WHERE reason='보안 전환 전 원본');
INSERT INTO rollbook_private.accounts(id,username,role,password_hash,memo,created_at)
SELECT 'master',payload->'masterAccount'->>'username','master',
  extensions.crypt(payload->'masterAccount'->>'password',extensions.gen_salt('bf',10)),
  '',to_char(now() AT TIME ZONE 'Asia/Seoul','YYYY-MM-DD HH24:MI:SS')
FROM public.attendance_data WHERE id='main_attendance_state'
  AND length(payload->'masterAccount'->>'password')>0 ON CONFLICT DO NOTHING;
INSERT INTO rollbook_private.accounts(id,username,role,password_hash,memo,created_at)
SELECT a->>'id',a->>'username','general',
  extensions.crypt(a->>'password',extensions.gen_salt('bf',10)),
  coalesce(a->>'memo',a->>'name',''),coalesce(a->>'createdAt','')
FROM public.attendance_data CROSS JOIN LATERAL jsonb_array_elements(payload->'generalAdmins') a
WHERE id='main_attendance_state' AND length(a->>'password')>0 ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.rollbook_api(action text, session_token text DEFAULT '', body jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a rollbook_private.accounts%ROWTYPE;
  sess rollbook_private.sessions%ROWTYPE;
  lim rollbook_private.login_limits%ROWTYPE;
  state jsonb; result jsonb; token text; scope text; hash text;
  target rollbook_private.accounts%ROWTYPE; p jsonb; rec record; revision timestamptz;
BEGIN
  IF action='status' THEN RETURN jsonb_build_object('ok',true,'secure',true); END IF;
  IF action='login' THEN
    IF length(coalesce(body->>'username','')) NOT BETWEEN 1 AND 80
      OR length(coalesce(body->>'password','')) NOT BETWEEN 1 AND 256
      OR body->>'role' NOT IN ('master','general') THEN
      RETURN jsonb_build_object('ok',false,'error','아이디 또는 비밀번호가 맞지 않습니다.');
    END IF;
    INSERT INTO rollbook_private.login_limits(username,role) VALUES(body->>'username',body->>'role') ON CONFLICT DO NOTHING;
    SELECT * INTO lim FROM rollbook_private.login_limits WHERE username=body->>'username' AND role=body->>'role' FOR UPDATE;
    IF lim.window_start < now()-interval '15 minutes' THEN
      UPDATE rollbook_private.login_limits SET attempts=0,window_start=now() WHERE username=lim.username AND role=lim.role;
      lim.attempts:=0;
    END IF;
    IF lim.attempts>=10 THEN RETURN jsonb_build_object('ok',false,'error','로그인 시도가 많습니다. 15분 뒤 다시 시도해 주세요.'); END IF;
    SELECT * INTO a FROM rollbook_private.accounts WHERE username=body->>'username' AND role=body->>'role' AND NOT disabled;
    IF a.id IS NULL OR a.password_hash <> extensions.crypt(body->>'password',a.password_hash) THEN
      UPDATE rollbook_private.login_limits SET attempts=attempts+1 WHERE username=lim.username AND role=lim.role;
      RETURN jsonb_build_object('ok',false,'error','아이디 또는 비밀번호가 맞지 않습니다.');
    END IF;
    UPDATE rollbook_private.login_limits SET attempts=0 WHERE username=lim.username AND role=lim.role;
    scope:=CASE WHEN a.role='master' THEN 'master' WHEN body->>'destination'='management' THEN 'management' ELSE 'attendance' END;
    token:=encode(extensions.gen_random_bytes(32),'hex');
    INSERT INTO rollbook_private.sessions VALUES(encode(extensions.digest(token,'sha256'),'hex'),a.id,a.version,scope,now()+interval '8 hours');
    IF length(session_token)>0 THEN UPDATE rollbook_private.sessions SET expires_at=now() WHERE token_hash=encode(extensions.digest(session_token,'sha256'),'hex'); END IF;
    RETURN jsonb_build_object('ok',true,'token',token,'account',jsonb_build_object('id',a.id,'username',a.username,'role',a.role));
  END IF;
  SELECT * INTO sess FROM rollbook_private.sessions WHERE token_hash=encode(extensions.digest(session_token,'sha256'),'hex') AND expires_at>now();
  SELECT * INTO a FROM rollbook_private.accounts WHERE id=sess.account_id AND NOT disabled AND version=sess.version;
  IF a.id IS NULL THEN RETURN jsonb_build_object('ok',false,'error','인증이 만료되었습니다. 다시 로그인해 주세요.','expired',true); END IF;
  IF action='logout' THEN
    UPDATE rollbook_private.sessions SET expires_at=now() WHERE token_hash=sess.token_hash;
    RETURN jsonb_build_object('ok',true);
  END IF;
  IF action='attendance' AND a.role='general' THEN
    UPDATE rollbook_private.sessions SET scope='attendance' WHERE token_hash=sess.token_hash;
    RETURN jsonb_build_object('ok',true);
  END IF;
  IF action='get' THEN
    SELECT payload,updated_at INTO state,revision FROM public.attendance_data WHERE id='main_attendance_state';
    result:=state-'adminPassword'-'masterAccount'-'generalAdmins'-'orgSecurityCode';
    IF a.role='master' THEN
      result:=result||jsonb_build_object('masterAccount',jsonb_build_object('id',a.id,'username',a.username),'generalAdmins',
        coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'username',username,'memo',memo,'createdAt',created_at) ORDER BY created_at,id)
          FROM rollbook_private.accounts WHERE role='general' AND NOT disabled),'[]'::jsonb));
    ELSE result:=result||jsonb_build_object('masterAccount','{}'::jsonb,'generalAdmins','[]'::jsonb); END IF;
    RETURN jsonb_build_object('ok',true,'data',result||jsonb_build_object('_revision',revision));
  END IF;
  IF action='save' THEN
    SELECT payload,updated_at INTO state,revision FROM public.attendance_data WHERE id='main_attendance_state' FOR UPDATE;
    IF state IS NULL THEN RETURN jsonb_build_object('ok',false,'error','기존 자료를 찾을 수 없습니다.'); END IF;
    IF body->>'_revision' IS NULL OR (body->>'_revision')::timestamptz<>revision THEN
      RETURN jsonb_build_object('ok',false,'error','다른 기기에서 자료가 변경됐습니다. 새로고침 후 다시 수정해 주세요.','conflict',true);
    END IF;
    IF jsonb_typeof(body->'programs') IS DISTINCT FROM 'array' THEN RETURN jsonb_build_object('ok',false,'error','프로그램 자료 형식이 올바르지 않습니다.'); END IF;
    INSERT INTO rollbook_private.state_history(reason,payload) VALUES('변경 전 자동 보관',state);
    IF sess.scope='attendance' THEN
      -- 출석 화면에서는 기존 참여자/회차의 출석 기록만 변경할 수 있다.
      FOR p IN SELECT value FROM jsonb_array_elements(body->'programs') LOOP
        FOR rec IN SELECT key,value FROM jsonb_each(coalesce(p->'records','{}'::jsonb)) LOOP
          IF rec.value->>'status' IS NULL OR rec.value->>'status' NOT IN ('attended','absent') OR
             NOT EXISTS(SELECT 1 FROM jsonb_array_elements(state->'programs') oldp
               CROSS JOIN LATERAL jsonb_array_elements(oldp->'participants') participant
               CROSS JOIN LATERAL jsonb_array_elements(oldp->'sessions') session
               WHERE oldp->>'id'=p->>'id' AND rec.key=(participant->>'id')||'_'||(session->>'id')) THEN
            RETURN jsonb_build_object('ok',false,'error','출석 기록 형식이 올바르지 않습니다.');
          END IF;
        END LOOP;
      END LOOP;
      state:=jsonb_set(state,'{programs}',(SELECT jsonb_agg(oldp||jsonb_build_object('records',coalesce(oldp->'records','{}'::jsonb)||
        coalesce((SELECT newp->'records' FROM jsonb_array_elements(body->'programs') newp WHERE newp->>'id'=oldp->>'id' LIMIT 1),'{}'::jsonb)))
        FROM jsonb_array_elements(state->'programs') oldp));
    ELSE
      -- 계정 정보는 별도 API만 변경한다. 예전 계정 원본도 이 저장으로 덮어쓰지 않는다.
      state:=state||(body-'adminPassword'-'masterAccount'-'generalAdmins'-'orgSecurityCode'-'_revision');
    END IF;
    UPDATE public.attendance_data SET payload=state,updated_at=now() WHERE id='main_attendance_state';
    RETURN jsonb_build_object('ok',true,'revision',now());
  END IF;
  IF action='change_password' THEN
    IF coalesce(a.password_hash<>extensions.crypt(body->>'current',a.password_hash),true) THEN RETURN jsonb_build_object('ok',false,'error','현재 비밀번호가 맞지 않습니다.'); END IF;
    IF length(coalesce(body->>'password','')) NOT BETWEEN 4 AND 72 THEN RETURN jsonb_build_object('ok',false,'error','새 비밀번호는 4~72자로 입력해 주세요.'); END IF;
    IF sess.scope='attendance' THEN RETURN jsonb_build_object('ok',false,'error','담당자 관리 화면에서 변경해 주세요.'); END IF;
    IF body ? 'username' AND length(coalesce(body->>'username','')) NOT BETWEEN 1 AND 80 THEN RETURN jsonb_build_object('ok',false,'error','아이디는 1~80자로 입력해 주세요.'); END IF;
    UPDATE rollbook_private.accounts SET username=coalesce(nullif(body->>'username',''),username),
      password_hash=extensions.crypt(body->>'password',extensions.gen_salt('bf',10)),version=version+1 WHERE id=a.id;
    UPDATE rollbook_private.sessions SET version=a.version+1 WHERE token_hash=sess.token_hash;
    RETURN jsonb_build_object('ok',true);
  END IF;
  IF a.role<>'master' OR sess.scope<>'master' THEN RETURN jsonb_build_object('ok',false,'error','관리자 인증이 필요합니다.'); END IF;
  IF action='account_save' THEN
    IF length(coalesce(body->>'username','')) NOT BETWEEN 1 AND 80 THEN RETURN jsonb_build_object('ok',false,'error','아이디를 입력해 주세요.'); END IF;
    SELECT * INTO target FROM rollbook_private.accounts WHERE id=body->>'id' AND role='general' AND NOT disabled;
    IF target.id IS NULL OR length(coalesce(body->>'password',''))>0 THEN
      IF length(coalesce(body->>'password','')) NOT BETWEEN 4 AND 72 THEN RETURN jsonb_build_object('ok',false,'error','비밀번호는 4~72자로 입력해 주세요.'); END IF;
      hash:=extensions.crypt(body->>'password',extensions.gen_salt('bf',10));
    ELSE hash:=target.password_hash; END IF;
    IF target.id IS NOT NULL THEN
      UPDATE rollbook_private.accounts SET username=body->>'username',memo=coalesce(body->>'memo',''),password_hash=hash,version=version+1 WHERE id=target.id;
    ELSE
      INSERT INTO rollbook_private.accounts VALUES('adm_'||gen_random_uuid()::text,body->>'username','general',hash,coalesce(body->>'memo',''),to_char(now() AT TIME ZONE 'Asia/Seoul','YYYY-MM-DD HH24:MI:SS'),false,1);
    END IF;
    RETURN jsonb_build_object('ok',true);
  END IF;
  IF action='account_archive' THEN
    UPDATE rollbook_private.accounts SET disabled=true,version=version+1 WHERE id=body->>'id' AND role='general';
    RETURN jsonb_build_object('ok',true);
  END IF;
  RETURN jsonb_build_object('ok',false,'error','지원하지 않는 요청입니다.');
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('ok',false,'error','이미 사용 중인 아이디입니다.');
END;
$$;
REVOKE ALL ON FUNCTION public.rollbook_api(text,text,jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rollbook_api(text,text,jsonb) FROM anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rollbook_api(text,text,jsonb) TO service_role;

-- 공개 테이블의 직접 접근은 RLS와 권한에서 모두 차단한다.
-- 정책만 교체하며 테이블 및 행은 삭제하지 않는다.
ALTER TABLE public.attendance_data ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow anon read access on attendance_data" ON public.attendance_data;
DROP POLICY IF EXISTS "Allow anon insert/update access on attendance_data" ON public.attendance_data;
CREATE POLICY "Block direct attendance access" ON public.attendance_data AS RESTRICTIVE FOR ALL TO anon,authenticated USING(false) WITH CHECK(false);
REVOKE ALL ON public.attendance_data FROM anon,authenticated;
NOTIFY pgrst,'reload schema';

-- 서버 전용 자료에도 명시적인 접근 차단 정책을 둔다.
CREATE POLICY "Server only" ON rollbook_private.accounts FOR ALL TO anon,authenticated USING(false) WITH CHECK(false);
CREATE POLICY "Server only" ON rollbook_private.sessions FOR ALL TO anon,authenticated USING(false) WITH CHECK(false);
CREATE POLICY "Server only" ON rollbook_private.login_limits FOR ALL TO anon,authenticated USING(false) WITH CHECK(false);
CREATE POLICY "Server only" ON rollbook_private.state_history FOR ALL TO anon,authenticated USING(false) WITH CHECK(false);
