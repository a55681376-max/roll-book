import assert from 'node:assert/strict';
import fs from 'node:fs';
import handler, {parseHolidays} from '../netlify/functions/korean-holidays.mjs';
const fixture=JSON.parse(fs.readFileSync('tests/fixtures/korean-holidays.json','utf8'));
const calendar=year=>'BEGIN:VCALENDAR\r\n'+Object.entries(fixture[year]).flatMap(([date,names])=>names.map(name=>{
  const start=new Date(date+'T00:00:00Z'),end=new Date(start);end.setUTCDate(end.getUTCDate()+1);
  return `BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:${date.replaceAll('-','')}\r\nDTEND;VALUE=DATE:${end.toISOString().slice(0,10).replaceAll('-','')}\r\nSUMMARY:${name}\r\nEND:VEVENT\r\n`;
})).join('')+'END:VCALENDAR';
assert.deepEqual(parseHolidays(calendar(2026),2026),fixture[2026]);
assert.throws(()=>parseHolidays('invalid',2026));
assert.throws(()=>parseHolidays(calendar(2026),2040));
globalThis.fetch=async()=>new Response(calendar(2026));
assert.equal((await handler(new Request('https://example.com/?year=2026'))).status,200);
assert.equal((await handler(new Request('https://example.com/?year=oops'))).status,400);
assert.equal((await handler(new Request('https://example.com/?year=2026',{method:'POST'}))).status,405);
globalThis.fetch=async()=>{throw Error('unavailable');};
const failed=await handler(new Request('https://example.com/?year=2027'));
assert.equal(failed.status,502);assert((await failed.json()).error.includes('기존 일정은 유지'));
console.log('PASS: holiday calendar parsing, unavailable years, method/input checks, failed-source handling');
