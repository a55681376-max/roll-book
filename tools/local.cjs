const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const holidays = import('../netlify/functions/korean-holidays.mjs');

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1:8765');
  res.setHeader('Cache-Control', 'no-store');
  if (url.pathname === '/.netlify/functions/korean-holidays') {
    try {
      const response = await (await holidays).default(new Request(url, {method: req.method}));
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(await response.text());
    } catch {
      res.writeHead(502, {'Content-Type': 'application/json; charset=utf-8'});
      res.end(JSON.stringify({error: '공휴일 연결을 확인해 주세요.'}));
    }
    return;
  }
  if (req.method !== 'GET' || !['/', '/index.html'].includes(url.pathname)) {
    res.writeHead(404); res.end(); return;
  }
  res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
  fs.createReadStream(path.join(root, 'index.html')).pipe(res);
}).on('error', error => {
  console.error(error.code === 'EADDRINUSE'
    ? 'Port 8765 is in use. Close the other preview server and retry.' : error.message);
  process.exitCode = 1;
}).listen(8765, '127.0.0.1', () => {
  console.log('Open http://127.0.0.1:8765 in your browser.');
  console.log('LIVE DATABASE: changes are saved to the real attendance data.');
  console.log('Keep this window open. Press Ctrl+C to stop.');
});
