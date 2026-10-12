const http=require('http'),fs=require('fs');
http.createServer((req,res)=>{
 if(req.url!=='/'&&req.url!=='/index.html'){res.writeHead(404);return res.end();}
 let html=fs.readFileSync('index.html','utf8');
 // Preview is isolated from the live database by a demo-only RPC adapter.
 html=html.replace('  <script>','  <script>'+fs.readFileSync('tools/preview-api.js','utf8')+'\n</script>\n  <script>');
 res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);
}).listen(8765,'127.0.0.1',()=>console.log('Preview: http://127.0.0.1:8765 (cloud sync disabled)'));
