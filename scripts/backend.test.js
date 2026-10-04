const assert = require('node:assert/strict');
const test = require('node:test');
const { BUSINESS_APIS_AVAILABLE, checkHealth } = require('../src/backend');

function healthyPayload() {
  return {
    status: 'ok',
    release: 'test-release',
    runtime: { node: '24.10.0', mode: 'production' },
    checks: { environment: 'ok', pg: 'ok', drizzle: 'ok', migration: 'ok' },
  };
}

test('health uses the public contract without credentials or device/profile headers', async () => {
  let request;
  const result = await checkHealth({
    fetchImpl: async (url, options) => {
      request = { url, options };
      return Response.json(healthyPayload());
    },
  });
  assert.equal(result.status, 'ok');
  assert.equal(result.release, 'test-release');
  assert.ok(Number.isFinite(Date.parse(result.checkedAt)));
  assert.equal(BUSINESS_APIS_AVAILABLE, false);
  assert.equal(request.url, 'https://deals.tillgreen.eu/api/health');
  assert.equal(request.options.method, 'GET');
  assert.deepEqual(request.options.headers, { Accept: 'application/json' });
  assert.equal(request.options.body, undefined);
  assert.equal(request.options.credentials, 'omit');
  assert.equal(request.options.redirect, 'error');
  assert.equal(request.options.cache, 'no-store');
});

test('503 returns an explicit unavailable failure', async () => {
  const result = await checkHealth({ fetchImpl: async () => Response.json({ status: 'error' }, { status: 503 }) });
  assert.equal(result.status, 'error');
  assert.match(result.message, /unavailable.*503/);
});

test('rejects malformed success payloads and incorrect status codes', async () => {
  const invalid = [
    null,
    { status: 'ok' },
    { ...healthyPayload(), release: 123 },
    { ...healthyPayload(), runtime: { node: '22.0.0', mode: 'production' } },
    { ...healthyPayload(), runtime: { node: '24.0.0', mode: 'development' } },
    ...['environment', 'pg', 'drizzle', 'migration'].map((name) => ({
      ...healthyPayload(), checks: { ...healthyPayload().checks, [name]: 'error' },
    })),
  ];
  for (const payload of invalid) {
    const result = await checkHealth({ fetchImpl: async () => Response.json(payload) });
    assert.equal(result.status, 'error', JSON.stringify(payload));
  }
  const result = await checkHealth({ fetchImpl: async () => Response.json(healthyPayload(), { status: 201 }) });
  assert.equal(result.status, 'error');
});

test('rejects HTML and malformed JSON instead of reporting healthy', async () => {
  for (const response of [
    new Response('<html>error</html>', { headers: { 'content-type': 'text/html' } }),
    new Response('{invalid', { headers: { 'content-type': 'application/json' } }),
  ]) {
    const result = await checkHealth({ fetchImpl: async () => response });
    assert.equal(result.status, 'error');
    assert.ok(result.message);
  }
});

test('reports network failure and timeout', async () => {
  const offline = await checkHealth({ fetchImpl: async () => { throw new Error('offline'); } });
  assert.equal(offline.status, 'error');
  assert.equal(offline.message, 'offline');
  const timeout = await checkHealth({
    timeoutMs: 5,
    fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }),
  });
  assert.equal(timeout.status, 'error');
  assert.match(timeout.message, /timed out/);
});
