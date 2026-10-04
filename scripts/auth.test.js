const assert = require('node:assert/strict');
const test = require('node:test');
const { createAuth, registerAuthIpc } = require('../src/auth');
const { rendererTrust } = require('../src/window-trust');

const INSTALLATION = '11111111-1111-4111-8111-111111111111';
const CHALLENGE = '22222222-2222-4222-8222-222222222222';
const ACCOUNT = '33333333-3333-4333-8333-333333333333';
const SESSION = '44444444-4444-4444-8444-444444444444';
const TOKEN = 'opaque-test-token-with-no-required-prefix';
const START = Date.parse('2026-10-04T08:00:00Z');

function fixture({ secure = true, storageBackend = 'gnome_libsecret', failStorage = false, seed = new Map(), timeoutMs = 100 } = {}) {
  const files = seed;
  const requests = [];
  const logs = [];
  const replies = [];
  const events = [];
  let time = START;
  let uuidCalls = 0;
  const dependencies = {
    app: { getPath: () => '/auth-test' },
    safeStorage: {
      isEncryptionAvailable: () => secure,
      getSelectedStorageBackend: () => storageBackend,
      encryptString: (value) => `encrypted:${value}`,
      decryptString: (value) => String(value).slice('encrypted:'.length),
    },
    log: (...args) => logs.push(args),
    fileSystem: {
      existsSync: (file) => files.has(file),
      readFileSync: (file) => files.get(file),
      writeFileSync: (file, value, options) => {
        if (file.endsWith('auth-session.bin') && failStorage) throw new Error('disk failure with sensitive text');
        events.push({ type: 'write', file, mode: options.mode });
        files.set(file, value);
      },
      unlinkSync: (file) => { events.push({ type: 'delete', file }); files.delete(file); },
    },
    randomUUID: () => { uuidCalls++; return INSTALLATION; },
    now: () => time,
    timeoutMs,
    fetchImpl: async (url, options) => {
      requests.push({ url, ...options, body: options.body === undefined ? undefined : JSON.parse(options.body) });
      events.push({ type: 'request', url });
      const reply = replies.shift();
      assert.ok(reply, 'Unexpected request');
      if (typeof reply === 'function') return reply(options);
      return reply;
    },
  };
  const auth = createAuth(dependencies);
  return {
    auth, files, requests, logs, replies, events,
    advance: (ms) => { time += ms; },
    restart: () => createAuth(dependencies),
    uuidCalls: () => uuidCalls,
  };
}

function challengeResponse(id = CHALLENGE) {
  return Response.json({
    challengeId: id, expiresAt: new Date(START + 600000).toISOString(), resendAfterSeconds: 60,
  }, { status: 202 });
}

function verificationPayload() {
  return {
    token: TOKEN, expiresAt: new Date(START + 30 * 86400000).toISOString(),
    account: { id: ACCOUNT, email: 'user@example.test', emailVerifiedAt: new Date(START).toISOString() },
    session: { id: SESSION, installationId: INSTALLATION },
  };
}

function accountResponse() {
  const verified = verificationPayload();
  return Response.json({ account: verified.account, session: { ...verified.session, expiresAt: verified.expiresAt } });
}

function errorResponse(code, status, retry) {
  return Response.json({ error: { code, message: `server-message-${TOKEN}` } }, {
    status, headers: retry === undefined ? {} : { 'Retry-After': String(retry) },
  });
}

async function signIn(f) {
  f.replies.push(challengeResponse(), Response.json(verificationPayload()));
  assert.equal((await f.auth.requestCode({ email: ' User@Example.Test ' })).ok, true);
  const result = await f.auth.verifyCode({ code: '012345' });
  assert.equal(result.ok, true);
  return result;
}

test('exact auth payloads, random persistent installation ID, leading-zero code and opaque token privacy', async () => {
  const f = fixture();
  const verified = await signIn(f);
  assert.equal(verified.auth.status, 'authenticated');
  assert.equal(verified.auth.account.email, 'user@example.test');
  assert.equal(verified.auth.storage, 'encrypted');
  assert.equal(JSON.stringify(verified).includes(TOKEN), false);
  assert.deepEqual(f.requests[0].body, { email: 'user@example.test', installationId: INSTALLATION });
  assert.deepEqual(f.requests[1].body, { challengeId: CHALLENGE, installationId: INSTALLATION, code: '012345' });
  assert.equal(f.requests[0].url, 'https://deals.tillgreen.eu/api/v1/auth/request-code');
  assert.equal(f.requests[1].url, 'https://deals.tillgreen.eu/api/v1/auth/verify-code');
  for (const request of f.requests) {
    assert.deepEqual(request.headers, { Accept: 'application/json', 'Content-Type': 'application/json' });
    assert.equal(request.credentials, 'omit');
    assert.equal(request.redirect, 'error');
    assert.equal(request.cache, 'no-store');
  }
  assert.equal(f.events.filter((event) => event.type === 'write').every((event) => event.mode === 0o600), true);
  const restored = f.restart();
  assert.equal((await restored.getState()).auth.status, 'unconfirmed');
  assert.equal(f.uuidCalls(), 1);
  f.replies.push(accountResponse());
  assert.equal((await restored.refresh()).auth.status, 'authenticated');
  assert.equal(f.requests[2].url, 'https://deals.tillgreen.eu/api/v1/account');
  assert.equal(f.requests[2].headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(f.requests[2].body, undefined);
  assert.equal(JSON.stringify(f.logs).includes(TOKEN), false);
});

test('insecure encryption, Linux basic_text/unknown and disk write failure are memory-only', async () => {
  for (const options of [{ secure: false }, { storageBackend: 'basic_text' }, { storageBackend: 'unknown' }, { failStorage: true }]) {
    const f = fixture(options);
    const result = await signIn(f);
    assert.equal(result.auth.storage, 'memory');
    assert.ok(result.auth.storageNotice);
    assert.equal(f.files.has('/auth-test/auth-session.bin'), false);
    assert.equal((await f.restart().getState()).auth.status, 'signedOut');
    assert.equal(JSON.stringify(f.logs).includes(TOKEN), false);
  }
});

test('rejects extra request fields and non-ASCII/six-digit codes without HTTP', async () => {
  const f = fixture();
  for (const input of [{ email: 'bad' }, { email: 'user@example.test', hardware: {} }, { email: 123 }, null]) {
    assert.equal((await f.auth.requestCode(input)).code, 'INVALID_REQUEST');
  }
  for (const input of [{ code: '１２３４５６' }, { code: '12345' }, { code: 123456 }, { code: '123456', challengeId: CHALLENGE }]) {
    assert.equal((await f.auth.verifyCode(input)).code, 'INVALID_REQUEST');
  }
  assert.equal(f.requests.length, 0);
});

test('resend cooldown, challenge replacement and expired code prevent stale verification', async () => {
  const f = fixture();
  f.replies.push(challengeResponse());
  await f.auth.requestCode({ email: 'user@example.test' });
  const throttled = await f.auth.requestCode({ email: 'user@example.test' });
  assert.equal(throttled.code, 'RATE_LIMITED');
  assert.equal(throttled.retryAfterSeconds, 60);
  assert.equal(f.requests.length, 1);
  f.advance(60000);
  const nextChallenge = '55555555-5555-4555-8555-555555555555';
  f.replies.push(challengeResponse(nextChallenge), errorResponse('CODE_INVALID', 400));
  await f.auth.requestCode({ email: 'user@example.test' });
  const wrong = await f.auth.verifyCode({ code: '123456' });
  assert.equal(wrong.code, 'CODE_INVALID');
  assert.equal(f.requests[2].body.challengeId, nextChallenge);
  assert.equal(JSON.stringify(wrong).includes(TOKEN), false);
  f.advance(600000);
  assert.equal((await f.auth.verifyCode({ code: '123456' })).code, 'CODE_EXPIRED');
  assert.equal(f.requests.length, 3);
});

test('all agreed errors are surfaced, including Retry-After and attempts exceeded', async () => {
  const f = fixture();
  f.replies.push(errorResponse('RATE_LIMITED', 429, 120));
  const limited = await f.auth.requestCode({ email: 'user@example.test' });
  assert.equal(limited.code, 'RATE_LIMITED');
  assert.equal(limited.retryAfterSeconds, 120);
  await f.auth.requestCode({ email: 'user@example.test' });
  assert.equal(f.requests.length, 1);
  f.advance(120000);
  for (const [code, status] of [
    ['INVALID_REQUEST', 400], ['UNSUPPORTED_MEDIA_TYPE', 415], ['PAYLOAD_TOO_LARGE', 413],
    ['EMAIL_UNAVAILABLE', 503], ['AUTH_UNAVAILABLE', 503], ['INTERNAL_ERROR', 500],
  ]) {
    f.replies.push(errorResponse(code, status));
    assert.equal((await f.auth.requestCode({ email: 'user@example.test' })).code, code);
  }
  f.replies.push(challengeResponse(), errorResponse('CODE_ATTEMPTS_EXCEEDED', 429, 60));
  await f.auth.requestCode({ email: 'user@example.test' });
  const attempts = await f.auth.verifyCode({ code: '123456' });
  assert.equal(attempts.code, 'CODE_ATTEMPTS_EXCEEDED');
  assert.equal(attempts.auth.challenge, null);
  assert.equal((await f.auth.verifyCode({ code: '123456' })).code, 'NO_CHALLENGE');
});

test('malformed/binding-mismatched verification is never authenticated', async () => {
  for (const mutate of [
    (value) => { delete value.token; },
    (value) => { value.token = 'bad\nheader'; },
    (value) => { value.account.email = 'different@example.test'; },
    (value) => { value.account.id = 'not-uuid'; },
    (value) => { value.session.installationId = CHALLENGE; },
    (value) => { value.expiresAt = new Date(START - 1).toISOString(); },
  ]) {
    const f = fixture();
    const payload = verificationPayload();
    mutate(payload);
    f.replies.push(challengeResponse(), Response.json(payload));
    await f.auth.requestCode({ email: 'user@example.test' });
    const result = await f.auth.verifyCode({ code: '012345' });
    assert.equal(result.code, 'INVALID_RESPONSE');
    assert.equal(result.auth.status, 'signedOut');
    assert.equal(f.files.has('/auth-test/auth-session.bin'), false);
  }
});

test('SESSION_INVALID clears auth only and preserves local data/BYOK/installation ID', async () => {
  const f = fixture();
  for (const name of ['profile.json', 'tilldeals-tracked-items.json', 'openai.key']) f.files.set(`/auth-test/${name}`, `local-${name}`);
  await signIn(f);
  f.replies.push(errorResponse('SESSION_INVALID', 401));
  const result = await f.auth.refresh();
  assert.equal(result.code, 'SESSION_INVALID');
  assert.equal(result.auth.status, 'signedOut');
  assert.equal(f.files.has('/auth-test/auth-session.bin'), false);
  for (const name of ['profile.json', 'tilldeals-tracked-items.json', 'openai.key', 'auth-installation.json']) {
    assert.equal(f.files.has(`/auth-test/${name}`), true);
  }
});

test('logout revokes before deletion; network failure retains token until explicit local sign-out', async () => {
  const f = fixture();
  await signIn(f);
  f.replies.push(() => { throw new Error(`network-${TOKEN}`); });
  const failed = await f.auth.logout();
  assert.equal(failed.ok, false);
  assert.equal(failed.code, 'NETWORK_ERROR');
  assert.equal(failed.revoked, undefined);
  assert.equal(f.files.has('/auth-test/auth-session.bin'), true);
  assert.equal(JSON.stringify(failed).includes(TOKEN), false);
  f.replies.push(new Response(null, { status: 204 }));
  const revoked = await f.auth.logout();
  assert.equal(revoked.revoked, true);
  assert.equal(revoked.auth.status, 'signedOut');
  const logout = f.requests.at(-1);
  assert.equal(logout.url, 'https://deals.tillgreen.eu/api/v1/auth/logout');
  assert.equal(logout.method, 'POST');
  assert.equal(logout.body, undefined);
  assert.equal(logout.headers['Content-Type'], undefined);
  assert.equal(logout.headers.Authorization, `Bearer ${TOKEN}`);
  const deletionIndex = f.events.findIndex((event) => event.type === 'delete');
  assert.equal(f.events[deletionIndex - 1].url, logout.url);
  const local = fixture();
  await signIn(local);
  const signedOut = await local.auth.signOutLocal();
  assert.equal(signedOut.localOnly, true);
  assert.equal(signedOut.revoked, false);
  assert.equal(local.requests.length, 2);
});

test('30-day absolute expiry clears saved session without refresh or HTTP', async () => {
  const f = fixture();
  await signIn(f);
  f.advance(30 * 86400000);
  assert.equal((await f.auth.refresh()).auth.status, 'signedOut');
  assert.equal(f.requests.length, 2);
  assert.equal(f.files.has('/auth-test/auth-session.bin'), false);
});

test('restored sessions remain unconfirmed when the server is unreachable, with no retries', async () => {
  const f = fixture();
  await signIn(f);
  const restored = f.restart();
  f.replies.push(() => { throw new Error('offline'); });
  const result = await restored.refresh();
  assert.equal(result.code, 'NETWORK_ERROR');
  assert.equal(result.auth.status, 'unconfirmed');
  assert.equal(f.requests.length, 3);
  assert.equal(f.files.has('/auth-test/auth-session.bin'), true);
});

test('stored tokens are not restored with insecure Linux storage', async () => {
  const f = fixture();
  await signIn(f);
  const unsafe = fixture({ seed: f.files, storageBackend: 'basic_text' });
  const result = await unsafe.auth.getState();
  assert.equal(result.auth.status, 'signedOut');
  assert.equal(result.auth.storageNotice, 'SECURE_STORAGE_UNAVAILABLE');
  assert.equal(unsafe.files.has('/auth-test/auth-session.bin'), false);
  assert.equal(unsafe.requests.length, 0);
});

test('404, invalid JSON and timeouts fail explicitly, without automatic retries', async () => {
  const f = fixture({ timeoutMs: 5 });
  f.replies.push(new Response('<html>not deployed</html>', { status: 404 }));
  assert.equal((await f.auth.requestCode({ email: 'user@example.test' })).code, 'ROUTE_UNAVAILABLE');
  f.replies.push(new Response('invalid', { headers: { 'content-type': 'application/json' } }));
  assert.equal((await f.auth.requestCode({ email: 'user@example.test' })).code, 'INVALID_RESPONSE');
  f.replies.push(({ signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error(TOKEN)), { once: true });
  }));
  assert.equal((await f.auth.requestCode({ email: 'user@example.test' })).code, 'REQUEST_TIMEOUT');
  assert.equal(f.requests.length, 3);
});

test('only the current local main frame can invoke auth IPC; navigation and windows are restricted', async () => {
  const handlers = new Map();
  const listeners = new Map();
  const frame = {};
  const webContents = {
    mainFrame: frame,
    on: (event, handler) => listeners.set(event, handler),
    setWindowOpenHandler: (handler) => listeners.set('open', handler),
  };
  const window = { webContents, isDestroyed: () => false };
  const trust = rendererTrust('/app/src/renderer/index.html', () => window);
  frame.url = trust.rendererUrl;
  const trusted = { sender: webContents, senderFrame: frame };
  let calls = 0;
  const methods = Object.fromEntries(['getState', 'requestCode', 'verifyCode', 'refresh', 'logout', 'signOutLocal']
    .map((name) => [name, () => { calls++; return {}; }]));
  registerAuthIpc({ handle: (channel, handler) => handlers.set(channel, handler) }, {
    auth: methods, isTrustedSender: trust.isTrustedSender, log: () => {},
  });
  for (const handler of handlers.values()) {
    for (const event of [
      { sender: webContents, senderFrame: { url: trust.rendererUrl } },
      { sender: {}, senderFrame: frame },
      { sender: webContents, senderFrame: null },
    ]) assert.throws(() => handler(event), /Untrusted/);
    handler(trusted);
  }
  assert.equal(calls, 6);
  frame.url = 'https://deals.tillgreen.eu';
  assert.equal(trust.isTrustedSender(trusted), false);
  trust.restrictNavigation(webContents);
  assert.deepEqual(listeners.get('open')(), { action: 'deny' });
  let prevented = 0;
  const event = { preventDefault: () => { prevented++; } };
  listeners.get('will-navigate')(event, 'https://evil.example');
  listeners.get('will-navigate')(event, trust.rendererUrl);
  listeners.get('will-redirect')(event);
  listeners.get('will-attach-webview')(event);
  assert.equal(prevented, 3);
});
