import { createClient } from 'npm:@supabase/supabase-js@2';
import holidayHandler from '../../../netlify/functions/korean-holidays.mjs';

// 비밀키는 Supabase 서버 환경에서만 읽는다. 브라우저나 저장소에 포함하지 않는다.
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
// 사용자가 HTML 직접 실행을 허용했다. file:// 요청은 Origin: null로 전달된다.
// null은 특정 파일/기기를 식별하지 않으므로 모든 데이터 권한은 아래 서버 인증으로 검사한다.
const origins = new Set(['https://roll-book.netlify.app', 'http://127.0.0.1:8765', 'http://localhost:8765', 'null']);
Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin') || '';
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': origins.has(origin) ? origin : 'https://roll-book.netlify.app',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Vary': 'Origin' };
  const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), {status, headers});
  if (origin && !origins.has(origin)) return response({ok:false,error:'허용되지 않은 주소입니다.'},403);
  if (req.method === 'OPTIONS') return new Response(null, {status:204, headers});
  if (req.method !== 'POST') return response({ok:false,error:'지원하지 않는 요청입니다.'},405);
  try {
    const input = await req.json();
    if (typeof input.action !== 'string' || input.action.length > 30 ||
      typeof input.session_token !== 'string' || input.session_token.length > 64 ||
      !input.body || typeof input.body !== 'object' || Array.isArray(input.body)) return response({ok:false,error:'요청 형식을 확인해 주세요.'},400);
    // 공개 로그인 요청도 비밀번호·시도 제한을 DB에서 검사한다.
    // 그 외 요청은 무작위 세션 토큰의 해시·만료·계정 버전·권한을 DB에서 검사한다.
    // 파일 직접 실행의 공휴일 요청도 기존 세션 인증을 통과해야 한다.
    const {data,error} = await db.rpc(input.action.startsWith('feedback_') ? 'rollbook_feedback' : 'rollbook_api', input.action === 'holidays'
      ? {action:'get',session_token:input.session_token,body:{}} : input);
    if (error) return response({ok:false,error:'요청을 처리하지 못했습니다.'});
    if (input.action === 'holidays' && data?.ok) {
      const calendar = await holidayHandler(new Request('https://rollbook.local/holidays?year=' + encodeURIComponent(String(input.body.year))));
      const result = await calendar.json();
      // 인증 확인에 사용한 원본 계정·출석 자료는 반환하지 않는다.
      return response({...result,ok:calendar.ok});
    }
    return response(data);
  } catch (_) { return response({ok:false,error:'요청을 처리하지 못했습니다.'},400); }
});
