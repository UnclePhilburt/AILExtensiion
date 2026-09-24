const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const net = require('node:net');

test('live lead delivery, reconnect snapshot, and immediate command delivery', { timeout: 15000 }, async () => {
  const probe = net.createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const child = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    env: { ...process.env, IMPACT_BRIDGE_PORT: String(port), IMPACT_BRIDGE_HOST: '127.0.0.1', IMPACT_BRIDGE_TOKEN: 'test-only' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const abort = new AbortController();
  const base = `http://127.0.0.1:${port}`;
  const request = (route, options = {}) => fetch(`${base}${route}`, { signal: abort.signal, ...options });
  const post = (route, body) => request(route, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-bridge-token': 'test-only' }, body: JSON.stringify(body)
  });
  try {
    await new Promise((resolve, reject) => {
      child.stdout.once('data', resolve);
      child.once('error', reject);
      child.once('exit', code => reject(new Error(`Bridge exited: ${code}`)));
    });
    assert.equal((await request('/api/events')).status, 401);
    const stream = await request('/api/events?token=test-only');
    const reader = stream.body.getReader();
    assert.match(new TextDecoder().decode((await reader.read()).value), /"lead":null/);
    const started = performance.now();
    await post('/api/current-lead', { lead: { available: true, leadName: 'Fictional test lead' } });
    assert.match(new TextDecoder().decode((await reader.read()).value), /Fictional test lead/);
    assert.ok(performance.now() - started < 1000, 'Live update should not wait for the old 2.5 second timer');
    await reader.cancel();
    const reconnected = await request('/api/events?token=test-only');
    const reconnectedReader = reconnected.body.getReader();
    assert.match(new TextDecoder().decode((await reconnectedReader.read()).value), /Fictional test lead/);
    await reconnectedReader.cancel();
    const pending = request('/api/command/next?wait=1&token=test-only').then(response => response.json());
    await new Promise(resolve => setTimeout(resolve, 100));
    const commandStart = performance.now();
    const sent = await (await post('/api/command', { type: 'next' })).json();
    const delivered = await pending;
    assert.equal(delivered.command.id, sent.command.id);
    assert.ok(performance.now() - commandStart < 1000, 'Waiting extension receives command immediately');
    const empty = await (await request('/api/command/next?token=test-only')).json();
    assert.equal(empty.command, null, 'Command is consumed once');
  } finally {
    abort.abort();
    child.kill();
  }
});
