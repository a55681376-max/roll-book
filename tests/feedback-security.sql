-- 임시 테스트 계정과 의견만 만들고, 마지막에 전부 롤백한다.
BEGIN;
DO $$
<<feedback_test>>
DECLARE
  prefix text := '__feedback_test_'||gen_random_uuid()::text;
  first_token text := encode(extensions.gen_random_bytes(32),'hex');
  other_token text := encode(extensions.gen_random_bytes(32),'hex');
  master_token text := encode(extensions.gen_random_bytes(32),'hex');
  kiosk_token text := encode(extensions.gen_random_bytes(32),'hex');
  id text; r jsonb;
BEGIN
  IF has_function_privilege('anon','public.rollbook_feedback(text,text,jsonb)','EXECUTE') OR
     has_function_privilege('authenticated','public.rollbook_feedback(text,text,jsonb)','EXECUTE') THEN
    RAISE EXCEPTION 'Browser roles must not execute the feedback RPC';
  END IF;
  IF NOT has_function_privilege('service_role','public.rollbook_feedback(text,text,jsonb)','EXECUTE') OR
     NOT has_function_privilege('service_role','rollbook_private.feedback_api(text,text,jsonb)','EXECUTE') THEN
    RAISE EXCEPTION 'Server role must be able to execute the feedback RPC';
  END IF;
  INSERT INTO rollbook_private.accounts(id,username,role,password_hash,created_at)
    VALUES(prefix||'a',prefix||'a','general','test-only-invalid-hash','test'),
          (prefix||'b',prefix||'b','general','test-only-invalid-hash','test'),
          (prefix||'m',prefix||'m','master','test-only-invalid-hash','test');
  INSERT INTO rollbook_private.sessions(token_hash,account_id,version,scope,expires_at)
    VALUES(encode(extensions.digest(first_token,'sha256'),'hex'),prefix||'a',1,'management',now()+interval '1 minute'),
          (encode(extensions.digest(other_token,'sha256'),'hex'),prefix||'b',1,'management',now()+interval '1 minute'),
          (encode(extensions.digest(master_token,'sha256'),'hex'),prefix||'m',1,'master',now()+interval '1 minute'),
          (encode(extensions.digest(kiosk_token,'sha256'),'hex'),prefix||'a',1,'attendance',now()+interval '1 minute');
  r:=public.rollbook_feedback('feedback_list','','{}');
  IF r->>'ok'<>'false' THEN RAISE EXCEPTION 'No session accepted'; END IF;
  r:=public.rollbook_feedback('feedback_create',kiosk_token,'{"title":"test","content":"test"}');
  IF r->>'ok'<>'false' THEN RAISE EXCEPTION 'Attendance session accepted'; END IF;
  r:=public.rollbook_feedback('feedback_create',first_token,'{"title":"테스트 의견","content":"실제 자료가 아닌 자동 검사입니다."}');
  IF r->>'ok'<>'true' THEN RAISE EXCEPTION 'Create failed: %',r; END IF;
  id:=r->>'id';
  r:=public.rollbook_feedback('feedback_list',other_token,'{}');
  IF jsonb_array_length(r->'items')<>0 THEN RAISE EXCEPTION 'Cross-account list leak'; END IF;
  r:=public.rollbook_feedback('feedback_read',other_token,jsonb_build_object('id',id,'version',1));
  IF r->>'ok'<>'false' THEN RAISE EXCEPTION 'Cross-account read accepted'; END IF;
  r:=public.rollbook_feedback('feedback_delete',other_token,jsonb_build_object('id',id,'version',0));
  IF r->>'ok'<>'false' THEN RAISE EXCEPTION 'Cross-account delete accepted'; END IF;
  r:=public.rollbook_feedback('feedback_delete',kiosk_token,jsonb_build_object('id',id,'version',0));
  IF r->>'ok'<>'false' THEN RAISE EXCEPTION 'Attendance delete accepted'; END IF;
  r:=public.rollbook_feedback('feedback_reply',first_token,jsonb_build_object('id',id,'version',0,'status','완료','reply','test'));
  IF r->>'ok'<>'false' THEN RAISE EXCEPTION 'Staff reply accepted'; END IF;
  r:=public.rollbook_feedback('feedback_reply',master_token,jsonb_build_object('id',id,'version',0,'status','완료','reply','반영했습니다.'));
  IF r->>'ok'<>'true' THEN RAISE EXCEPTION 'Admin reply failed: %',r; END IF;
  r:=public.rollbook_feedback('feedback_reply',master_token,jsonb_build_object('id',id,'version',0,'status','불가','reply','stale'));
  IF r->>'ok'<>'false' THEN RAISE EXCEPTION 'Stale reply accepted'; END IF;
  r:=public.rollbook_feedback('feedback_count',first_token,'{}');
  IF (r->>'count')::integer<>1 THEN RAISE EXCEPTION 'Unread count failed'; END IF;
  PERFORM public.rollbook_feedback('feedback_read',first_token,jsonb_build_object('id',id,'version',1));
  r:=public.rollbook_feedback('feedback_count',first_token,'{}');
  IF (r->>'count')::integer<>0 THEN RAISE EXCEPTION 'Read receipt failed'; END IF;
  PERFORM public.rollbook_feedback('feedback_reply',master_token,jsonb_build_object('id',id,'version',1,'status','보류','reply','다시 검토합니다.'));
  PERFORM public.rollbook_feedback('feedback_read',first_token,jsonb_build_object('id',id,'version',1));
  r:=public.rollbook_feedback('feedback_count',first_token,'{}');
  IF (r->>'count')::integer<>1 THEN RAISE EXCEPTION 'Old read cleared newer answer'; END IF;
  r:=public.rollbook_feedback('feedback_delete',first_token,jsonb_build_object('id',id,'version',1));
  IF r->>'ok'<>'false' THEN RAISE EXCEPTION 'Stale delete accepted'; END IF;
  r:=public.rollbook_feedback('feedback_delete',first_token,jsonb_build_object('id',id,'version',2));
  IF r->>'ok'<>'true' THEN RAISE EXCEPTION 'Owner delete failed: %',r; END IF;
  IF NOT EXISTS(SELECT 1 FROM rollbook_private.feedback f WHERE f.id=feedback_test.id::uuid AND f.deleted_at IS NOT NULL AND f.deleted_by=prefix||'a') THEN
    RAISE EXCEPTION 'Delete must retain the record and actor';
  END IF;
  r:=public.rollbook_feedback('feedback_count',first_token,'{}');
  IF (r->>'count')::integer<>0 THEN RAISE EXCEPTION 'Deleted feedback counted unread'; END IF;
  r:=public.rollbook_feedback('feedback_list',first_token,'{}');
  IF jsonb_array_length(r->'items')<>0 THEN RAISE EXCEPTION 'Owner still sees deleted feedback'; END IF;
  r:=public.rollbook_feedback('feedback_list',master_token,'{}');
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(r->'items') f WHERE f->>'id'=feedback_test.id) THEN RAISE EXCEPTION 'Admin still sees deleted feedback'; END IF;
  r:=public.rollbook_feedback('feedback_reply',master_token,jsonb_build_object('id',id,'version',2,'status','완료','reply','deleted'));
  IF r->>'ok'<>'false' THEN RAISE EXCEPTION 'Reply to deleted feedback accepted'; END IF;
  r:=public.rollbook_feedback('feedback_create',first_token,'{"title":"관리자 삭제 검사","content":"test"}');
  id:=r->>'id';
  r:=public.rollbook_feedback('feedback_delete',master_token,jsonb_build_object('id',id,'version',0));
  IF r->>'ok'<>'true' THEN RAISE EXCEPTION 'Admin delete failed: %',r; END IF;
  UPDATE rollbook_private.accounts a SET disabled=true WHERE a.id=prefix||'a';
  r:=public.rollbook_feedback('feedback_list',first_token,'{}');
  IF r->>'ok'<>'false' THEN RAISE EXCEPTION 'Disabled account accepted'; END IF;
END;
$$;
ROLLBACK;
