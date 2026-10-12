// 가입이나 인증키 없이 공개된 대한민국 '공휴일만' 달력을 읽는다.
export const source = 'https://calendar.google.com/calendar/ical/ko.south_korea.official%23holiday%40group.v.calendar.google.com/public/basic.ics';
const cache = new Map();
const reply = (status, body) => Response.json(body, {status, headers:{'Cache-Control':'no-store'}});
const unescapeText = text => text.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim();

export function parseHolidays(text, year) {
  if (!text.startsWith('BEGIN:VCALENDAR') || !text.includes('END:VCALENDAR')) throw new Error('invalid calendar');
  const holidays = {};
  for (const block of text.replace(/\r?\n[ \t]/g, '').split('BEGIN:VEVENT').slice(1)) {
    if (/^STATUS:CANCELLED\r?$/m.test(block)) continue;
    const start = block.match(/^DTSTART;VALUE=DATE:(\d{8})\r?$/m)?.[1];
    const end = block.match(/^DTEND;VALUE=DATE:(\d{8})\r?$/m)?.[1];
    const name = block.match(/^SUMMARY:(.*)\r?$/m)?.[1];
    if (!start || !end || !name) throw new Error('invalid event');
    const date = new Date(`${start.slice(0,4)}-${start.slice(4,6)}-${start.slice(6,8)}T00:00:00Z`);
    const until = new Date(`${end.slice(0,4)}-${end.slice(4,6)}-${end.slice(6,8)}T00:00:00Z`);
    const span = (until - date) / 86400000;
    if (!Number.isInteger(span) || span < 1 || span > 7) throw new Error('invalid range');
    for (let i=0; i<span; i++, date.setUTCDate(date.getUTCDate()+1)) {
      const iso = date.toISOString().slice(0,10);
      if (!iso.startsWith(`${year}-`)) continue;
      const label = unescapeText(name).replace(/^쉬는 날\s*/, '대체공휴일 · ');
      holidays[iso] = [...new Set([...(holidays[iso] || []), label])];
    }
  }
  // 잘린 응답이나 제공되지 않는 연도를 '공휴일 없음'으로 처리하지 않는다.
  if (Object.keys(holidays).length < 10 || !holidays[`${year}-01-01`] || !holidays[`${year}-12-25`]) throw new Error('year unavailable');
  return holidays;
}

export default async function handler(request) {
  if (request.method !== 'GET') return reply(405, {error:'허용되지 않은 요청입니다.'});
  const year = Number(new URL(request.url).searchParams.get('year'));
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return reply(400, {error:'올바른 연도를 선택해 주세요.'});
  const cached = cache.get(year);
  if (cached && cached.until > Date.now()) return reply(200, cached.data);
  try {
    const response = await fetch(source, {signal:AbortSignal.timeout(12000)});
    if (!response.ok) throw new Error('upstream');
    const text = await response.text();
    if (text.length > 1000000) throw new Error('too large');
    const holidays = parseHolidays(text, year);
    const data = {year, holidays, source, checkedAt:new Date().toISOString()};
    cache.set(year, {data, until:Date.now() + 60 * 60 * 1000});
    return reply(200, data);
  } catch (_) {
    return reply(502, {error:`${year}년 공휴일 자료를 확인하지 못했습니다. 기존 일정은 유지됩니다. 잠시 후 다시 시도해 주세요.`});
  }
}
