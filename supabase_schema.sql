-- 기존 자료와 테이블은 삭제하지 않습니다.
-- 새 설치: 공개 테이블 생성 시 RLS를 활성화하고 공개 접근을 허용하지 않습니다.
-- 기존 프로젝트 보안 전환은 supabase_security.sql에 기록되어 있습니다.
CREATE TABLE IF NOT EXISTS public.attendance_data (
  id text PRIMARY KEY, payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.attendance_data ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.attendance_data FROM anon,authenticated;
-- 계정 및 API가 준비되기 전에는 로그인/자료 접근이 허용되지 않습니다.
