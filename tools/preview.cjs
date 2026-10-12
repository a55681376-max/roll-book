const http=require('http'),fs=require('fs');
http.createServer((req,res)=>{
 if(req.url.startsWith('/.netlify/functions/korean-holidays?')) {
  const year=new URL(req.url,'http://localhost').searchParams.get('year');
  const holidays=JSON.parse(fs.readFileSync('tests/fixtures/korean-holidays.json','utf8'))[year];
  res.writeHead(holidays?200:502,{'Content-Type':'application/json'});
  return res.end(JSON.stringify(holidays?{year:Number(year),holidays}:{error:'해당 연도의 샘플 공휴일 자료가 없습니다.'}));
 }
 if(req.url!=='/'&&req.url!=='/index.html'){res.writeHead(404);return res.end();}
 let html=fs.readFileSync('index.html','utf8');
 // Preview is isolated from the live database by a demo-only RPC adapter.
 html=html.replace('  <script>','  <script>'+fs.readFileSync('tools/preview-api.js','utf8')+'\n</script>\n  <script>');
 res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);
}).listen(8765,'127.0.0.1',()=>console.log('Preview: http://127.0.0.1:8765 (cloud sync disabled)'));
