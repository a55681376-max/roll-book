const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {spawn} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const holidays = import('../netlify/functions/korean-holidays.mjs');
const address = 'http://127.0.0.1:8765';
const healthPath = '/__rollbook_local_health';
const projectId = createHash('sha256').update(process.platform === 'win32' ? root.toLowerCase() : root).digest('hex');

function createLocalServer() {
 return http.createServer(async (req, res) => {
  const url = new URL(req.url, address);
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET' && url.pathname === healthPath) {
    res.writeHead(200, {'Content-Type':'application/json; charset=utf-8'});
    res.end(JSON.stringify({app:'rollbook-local',projectId}));
    return;
  }
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
 });
}

async function isProjectRunning() {
  try {
    const response = await fetch(address + healthPath, {signal:AbortSignal.timeout(1500),redirect:'error'});
    if (!response.ok) return false;
    const info = await response.json();
    return info.app === 'rollbook-local' && info.projectId === projectId;
  } catch {return false;}
}

function openBrowser() {
  if (process.argv.includes('--no-open')) return;
  const command = process.platform === 'win32'
    ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'rundll32.exe')
    : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler',address] : [address];
  const child = spawn(command, args, {detached:true,stdio:'ignore',windowsHide:true});
  child.on('error', () => console.error('Browser could not be opened. Open ' + address + ' manually.'));
  child.unref();
}

async function main() {
  if (await isProjectRunning()) {
    console.log('This project is already running. Opening ' + address);
    openBrowser();
    return;
  }
  const server = createLocalServer();
  server.on('error', async error => {
    // Two shortcut launches can race to start the same server.
    if (error.code === 'EADDRINUSE' && await isProjectRunning()) {
      console.log('This project is already running. Opening ' + address);
      openBrowser();
      return;
    }
    console.error(error.code === 'EADDRINUSE'
      ? 'Port 8765 is used by a different server. Close that server and retry. No process was stopped.'
      : error.message);
    process.exitCode = 1;
  });
  server.listen(8765, '127.0.0.1', () => {
  console.log('Opening ' + address + ' in your default browser.');
  console.log('LIVE DATABASE: changes are saved to the real attendance data.');
  console.log('Keep this window open. Press Ctrl+C to stop.');
  openBrowser();
  });
}

module.exports = {createLocalServer, isProjectRunning, projectId, healthPath};
if (require.main === module) main().catch(error => {console.error(error.message);process.exitCode=1;});
