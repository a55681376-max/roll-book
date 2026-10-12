import { createClient } from 'npm:@supabase/supabase-js@2';

// 비밀키는 Supabase 서버 환경에서만 읽는다. 브라우저나 저장소에 포함하지 않는다.
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const origins = new Set(['https://rollbook1.netlify.app', 'http://127.0.0.1:8765', 'http://localhost:8765']);
Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin') || '';
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': origins.has(origin) ? origin : 'https://rollbook1.netlify.app',
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
    const {data,error} = await db.rpc('rollbook_api', input);
    if (error) return response({ok:false,error:'요청을 처리하지 못했습니다.'});
    return response(data);
  } catch (_) { return response({ok:false,error:'요청을 처리하지 못했습니다.'},400); }
});
