const fs = require('node:fs');
const assert = require('node:assert/strict');
const html = fs.readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
const base = html.match(/url: "([^"]+)"/)[1];
(async () => {
  try {
    assert.equal(await (await fetch('http://127.0.0.1:8765', {signal: AbortSignal.timeout(5000)})).text(), html);
    console.log('PASS: local server serves original HTML');
  } catch (error) {
    console.error('Local check failed:', error.cause?.code || error.message);
    process.exitCode = 1;
  }
  for (const [origin, status] of [['http://127.0.0.1:8765', 204], ['null', 204], ['https://not-allowed.example',403]]) {
    const response = await fetch(base + '/functions/v1/rollbook-api', {
      method: 'OPTIONS', headers: {Origin: origin, 'Access-Control-Request-Method': 'POST'},
    });
    assert.equal(response.status, status);
    if (status === 204) assert.equal(response.headers.get('access-control-allow-origin'), origin);
    console.log(`PASS: origin ${origin} returns ${status}`);
  }
})().catch(error => {console.error(error.message); process.exitCode = 1;});
