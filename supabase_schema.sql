-- ==============================================================================
-- 📚 노인복지관 배움터 전자출석부 - Supabase DB 스키마 & 설정 스크립트
-- ==============================================================================
-- 💡 사용 방법:
-- 1. https://supabase.com 로그인 후 프로젝트 생성
-- 2. 좌측 메뉴 [SQL Editor] 클릭 > [New Query] 클릭
-- 3. 아래 SQL 내용을 전체 복사하여 붙여넣고 [Run] (또는 Ctrl+Enter) 실행
-- 4. [Project Settings] > [API] 에서 Project URL과 anon key를 복사하여
--    전자출석부 우측 상단 [⚡ Supabase] 버튼을 눌러 입력하시면 끝납니다!
-- ==============================================================================

-- 1. 전자출석부 전체 상태 저장용 테이블 생성
CREATE TABLE IF NOT EXISTS public.attendance_data (
    id TEXT PRIMARY KEY,                       -- 식별자 ('main_attendance_state')
    payload JSONB NOT NULL,                    -- 프로그램, 회차, 참여자, 서명 기록 전체 JSON
    updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- 테이블 설명 코멘트
COMMENT ON TABLE public.attendance_data IS '노인복지관 전자출석부 전체 동기화 상태 저장 테이블';

-- 2. Row Level Security (RLS) 활성화
ALTER TABLE public.attendance_data ENABLE ROW LEVEL SECURITY;

-- 3. 누구나 읽기 / 쓰기 / 수정 가능하도록 정책(Policy) 부여 (익명 anon 키 허용)
-- (※ 내부 인트라넷 또는 복지관 태블릿/키오스크 공용 환경에 최적화된 정책입니다.)
DROP POLICY IF EXISTS "Allow anon read access on attendance_data" ON public.attendance_data;
CREATE POLICY "Allow anon read access on attendance_data"
ON public.attendance_data
FOR SELECT
TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS "Allow anon insert/update access on attendance_data" ON public.attendance_data;
CREATE POLICY "Allow anon insert/update access on attendance_data"
ON public.attendance_data
FOR ALL
TO anon, authenticated
USING (true)
WITH CHECK (true);

-- 4. Realtime (실시간 동기화) 활성화
-- 여러 기기(태블릿, PC 등)에서 출석 체크 시 실시간 화면 반영을 위해 replication 추가
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
      AND schemaname = 'public' 
      AND tablename = 'attendance_data'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.attendance_data;
  END IF;
END $$;

-- 5. 완료 메시지 확인
SELECT '✅ 노인복지관 전자출석부 Supabase 테이블 준비가 완료되었습니다!' AS result;
