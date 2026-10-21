-- 의견함은 출석 payload와 분리한다. 기존 계정·자료·인증 함수는 변경하지 않는다.
BEGIN;
CREATE TABLE IF NOT EXISTS rollbook_private.feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id text NOT NULL REFERENCES rollbook_private.accounts(id),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 100),
  content text NOT NULL CHECK (length(btrim(content)) BETWEEN 1 AND 5000),
  status text NOT NULL DEFAULT '접수' CHECK (status IN ('접수','완료','보류','불가')),
  reply text NOT NULL DEFAULT '' CHECK (length(reply)<=5000),
  replied_by text NOT NULL DEFAULT '',
  response_version integer NOT NULL DEFAULT 0,
  seen_version integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS feedback_author_created ON rollbook_private.feedback(author_id,created_at DESC);
ALTER TABLE rollbook_private.feedback ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS feedback_no_browser_access ON rollbook_private.feedback;
CREATE POLICY feedback_no_browser_access ON rollbook_private.feedback AS RESTRICTIVE FOR ALL TO anon,authenticated USING(false) WITH CHECK(false);
REVOKE ALL ON rollbook_private.feedback FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION rollbook_private.feedback_api(action text, session_token text, body jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  account rollbook_private.accounts%ROWTYPE;
  session rollbook_private.sessions%ROWTYPE;
  item rollbook_private.feedback%ROWTYPE;
  items jsonb;
BEGIN
  SELECT * INTO session FROM rollbook_private.sessions
    WHERE token_hash=encode(extensions.digest(session_token,'sha256'),'hex') AND expires_at>now();
  SELECT * INTO account FROM rollbook_private.accounts
    WHERE id=session.account_id AND NOT disabled AND version=session.version;
  IF account.id IS NULL THEN
    RETURN jsonb_build_object('ok',false,'expired',true,'error','다시 로그인해 주세요.');
  END IF;
  IF account.role<>'master' AND session.scope<>'management' THEN
    RETURN jsonb_build_object('ok',false,'error','담당자 인증 후 이용해 주세요.');
  END IF;
  IF action='feedback_count' THEN
    RETURN jsonb_build_object('ok',true,'count',(SELECT count(*) FROM rollbook_private.feedback
      WHERE author_id=account.id AND response_version>seen_version));
  ELSIF action='feedback_list' THEN
    SELECT coalesce(jsonb_agg(to_jsonb(f) ORDER BY f.created_at DESC,f.id),'[]'::jsonb) INTO items
      FROM (SELECT f.*,a.username AS author FROM rollbook_private.feedback f
        JOIN rollbook_private.accounts a ON a.id=f.author_id
        WHERE account.role='master' OR f.author_id=account.id
        ORDER BY f.created_at DESC,f.id LIMIT 200) f;
    RETURN jsonb_build_object('ok',true,'items',items);
  ELSIF action='feedback_create' THEN
    IF account.role<>'general' THEN RETURN jsonb_build_object('ok',false,'error','담당자만 의견을 보낼 수 있습니다.'); END IF;
    IF length(btrim(coalesce(body->>'title',''))) NOT BETWEEN 1 AND 100 OR
       length(btrim(coalesce(body->>'content',''))) NOT BETWEEN 1 AND 5000 THEN
      RETURN jsonb_build_object('ok',false,'error','제목은 100자, 내용은 5,000자 이내로 입력해 주세요.');
    END IF;
    -- 중복 클릭 외 대량 제출도 계정별로 제한한다.
    PERFORM pg_advisory_xact_lock(hashtext(account.id));
    IF (SELECT count(*) FROM rollbook_private.feedback WHERE author_id=account.id AND created_at>now()-interval '1 hour')>=20 THEN
      RETURN jsonb_build_object('ok',false,'error','잠시 후 다시 보내주세요.');
    END IF;
    INSERT INTO rollbook_private.feedback(author_id,title,content)
      VALUES(account.id,btrim(body->>'title'),btrim(body->>'content')) RETURNING * INTO item;
    RETURN jsonb_build_object('ok',true,'id',item.id);
  ELSIF action IN ('feedback_reply','feedback_read') THEN
    SELECT * INTO item FROM rollbook_private.feedback WHERE id=(body->>'id')::uuid FOR UPDATE;
    IF item.id IS NULL OR (account.role<>'master' AND item.author_id<>account.id) THEN
      RETURN jsonb_build_object('ok',false,'error','의견을 찾을 수 없습니다.');
    END IF;
    IF action='feedback_read' THEN
      IF item.author_id=account.id THEN
        UPDATE rollbook_private.feedback SET seen_version=greatest(seen_version,least(response_version,coalesce((body->>'version')::integer,0))) WHERE id=item.id;
      END IF;
      RETURN jsonb_build_object('ok',true);
    END IF;
    IF account.role<>'master' THEN RETURN jsonb_build_object('ok',false,'error','관리자만 답변할 수 있습니다.'); END IF;
    IF (body->>'version')::integer IS DISTINCT FROM item.response_version THEN
      RETURN jsonb_build_object('ok',false,'error','답변이 변경됐습니다. 목록을 다시 열어주세요.');
    END IF;
    IF coalesce(body->>'status','') NOT IN ('접수','완료','보류','불가') OR
      length(btrim(coalesce(body->>'reply',''))) NOT BETWEEN 1 AND 5000 THEN
      RETURN jsonb_build_object('ok',false,'error','상태와 답변을 입력해 주세요.');
    END IF;
    UPDATE rollbook_private.feedback SET status=body->>'status',reply=btrim(body->>'reply'),replied_by=account.username,
      response_version=response_version+1,updated_at=now() WHERE id=item.id;
    RETURN jsonb_build_object('ok',true);
  END IF;
  RETURN jsonb_build_object('ok',false,'error','지원하지 않는 요청입니다.');
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
  RETURN jsonb_build_object('ok',false,'error','요청 형식을 확인해 주세요.');
END;
$$;
REVOKE ALL ON FUNCTION rollbook_private.feedback_api(text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA rollbook_private TO service_role;
GRANT EXECUTE ON FUNCTION rollbook_private.feedback_api(text,text,jsonb) TO service_role;
CREATE OR REPLACE FUNCTION public.rollbook_feedback(action text, session_token text DEFAULT '', body jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $$ SELECT rollbook_private.feedback_api(action,session_token,body); $$;
REVOKE ALL ON FUNCTION public.rollbook_feedback(text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rollbook_feedback(text,text,jsonb) TO service_role;
COMMIT;
