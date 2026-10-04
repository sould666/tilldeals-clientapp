const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const ERROR_CODES = new Set([
  'INVALID_REQUEST', 'UNSUPPORTED_MEDIA_TYPE', 'PAYLOAD_TOO_LARGE', 'RATE_LIMITED',
  'CODE_INVALID', 'CODE_EXPIRED', 'CODE_ATTEMPTS_EXCEEDED', 'SESSION_INVALID',
  'EMAIL_UNAVAILABLE', 'AUTH_UNAVAILABLE', 'INTERNAL_ERROR',
]);

function isDate(value) {
  return typeof value === 'string' && ISO_DATE.test(value) && Number.isFinite(Date.parse(value));
}

function isAccount(value) {
  return UUID.test(value?.id) && typeof value.email === 'string'
    && value.email.length <= 254 && EMAIL.test(value.email) && isDate(value.emailVerifiedAt);
}

function exactInput(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function authError(code, retryAfterSeconds) {
  const error = new Error(code);
  error.code = code;
  error.authFailure = true;
  error.retryAfterSeconds = retryAfterSeconds;
  return error;
}

function createAuth({
  app, safeStorage, log, fetchImpl = globalThis.fetch, fileSystem = fs,
  randomUUID = crypto.randomUUID, now = Date.now, timeoutMs = 15000,
}) {
  const installationPath = path.join(app.getPath('userData'), 'auth-installation.json');
  const tokenPath = path.join(app.getPath('userData'), 'auth-session.bin');
  let installationId;
  let token = null;
  let session = null;
  let account = null;
  let confirmed = false;
  let loaded = false;
  let storage = 'none';
  let storageNotice = null;
  let challenge = null;
  let requestAllowedAt = 0;
  let verifyAllowedAt = 0;
  let queue = Promise.resolve();

  function secureAvailable() {
    return safeStorage.isEncryptionAvailable()
      && (process.platform !== 'linux'
        || (typeof safeStorage.getSelectedStorageBackend === 'function'
          && ['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'].includes(safeStorage.getSelectedStorageBackend())));
  }

  function getInstallationId() {
    if (installationId) return installationId;
    if (fileSystem.existsSync(installationPath)) {
      const stored = JSON.parse(fileSystem.readFileSync(installationPath, 'utf8'));
      if (!UUID.test(stored?.installationId)) throw authError('STORAGE_ERROR');
      installationId = stored.installationId;
    } else {
      const id = randomUUID();
      fileSystem.writeFileSync(installationPath, JSON.stringify({ installationId: id }), { mode: 0o600 });
      installationId = id;
    }
    return installationId;
  }

  function validSession(value, requireExpiry = true) {
    return UUID.test(value?.id) && value.installationId === getInstallationId()
      && (!requireExpiry || isDate(value.expiresAt));
  }

  function validToken(value) {
    return typeof value === 'string' && value.length > 0 && value.length <= 4096 && !/[\s\x00-\x1f\x7f]/.test(value);
  }

  function deleteStoredToken() {
    try {
      if (fileSystem.existsSync(tokenPath)) fileSystem.unlinkSync(tokenPath);
    } catch {
      throw authError('STORAGE_ERROR');
    }
  }

  function clearAuth() {
    token = null;
    account = null;
    session = null;
    confirmed = false;
    storage = 'none';
    storageNotice = null;
    deleteStoredToken();
  }

  function load() {
    if (loaded) return;
    getInstallationId();
    if (fileSystem.existsSync(tokenPath)) {
      if (!secureAvailable()) {
        deleteStoredToken();
        storageNotice = 'SECURE_STORAGE_UNAVAILABLE';
      } else {
        try {
          const stored = JSON.parse(safeStorage.decryptString(fileSystem.readFileSync(tokenPath)));
          if (!validToken(stored.token) || !isAccount(stored.account) || !validSession(stored.session)) {
            throw authError('STORAGE_ERROR');
          }
          token = stored.token;
          account = stored.account;
          session = stored.session;
          storage = 'encrypted';
        } catch {
          log('warn', 'Stored authentication session could not be restored.', { code: 'STORAGE_ERROR' });
          deleteStoredToken();
          storageNotice = 'STORAGE_ERROR';
        }
      }
    }
    loaded = true;
    if (session && Date.parse(session.expiresAt) <= now()) clearAuth();
  }

  function persist() {
    storage = 'memory';
    storageNotice = 'SECURE_STORAGE_UNAVAILABLE';
    if (!secureAvailable()) {
      deleteStoredToken();
      return;
    }
    try {
      fileSystem.writeFileSync(tokenPath, safeStorage.encryptString(JSON.stringify({ token, account, session })), { mode: 0o600 });
      storage = 'encrypted';
      storageNotice = null;
    } catch {
      deleteStoredToken();
      storageNotice = 'STORAGE_ERROR';
      log('warn', 'Authentication session is memory-only after a storage failure.', { code: 'STORAGE_ERROR' });
    }
  }

  function state() {
    return {
      status: token ? (confirmed ? 'authenticated' : 'unconfirmed') : 'signedOut',
      account: token ? { id: account.id, email: account.email, emailVerifiedAt: account.emailVerifiedAt } : null,
      expiresAt: session?.expiresAt || null,
      storage,
      storageNotice,
      challenge: challenge ? { expiresAt: challenge.expiresAt } : null,
      resendAfterSeconds: Math.max(0, Math.ceil((requestAllowedAt - now()) / 1000)),
    };
  }

  async function request(method, route, body, expectedStatus, bearer = false) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers = { Accept: 'application/json' };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (bearer) headers.Authorization = `Bearer ${token}`;
      const response = await fetchImpl(`https://deals.tillgreen.eu${route}`, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal, redirect: 'error', credentials: 'omit', cache: 'no-store',
      });
      if (response.status === 404) throw authError('ROUTE_UNAVAILABLE');
      if (response.status === 204 && expectedStatus === 204) return null;
      const type = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
      if (type !== 'application/json') throw authError('INVALID_RESPONSE');
      let payload;
      try {
        const text = await response.text();
        if (text.length > 16384) throw authError('INVALID_RESPONSE');
        payload = JSON.parse(text);
      } catch {
        throw authError('INVALID_RESPONSE');
      }
      if (response.status !== expectedStatus) {
        const code = ERROR_CODES.has(payload?.error?.code) && typeof payload.error.message === 'string'
          ? payload.error.code : 'INVALID_RESPONSE';
        const retryHeader = response.headers.get('retry-after');
        const retry = response.status === 429 && /^\d+$/.test(retryHeader || '')
          && Number.isSafeInteger(Number(retryHeader)) ? Number(retryHeader) : undefined;
        if (response.status === 401 && code === 'SESSION_INVALID') clearAuth();
        throw authError(code, retry);
      }
      return payload;
    } catch (error) {
      if (error.authFailure) throw error;
      throw authError(controller.signal.aborted ? 'REQUEST_TIMEOUT' : 'NETWORK_ERROR');
    } finally {
      clearTimeout(timeout);
    }
  }

  function run(operation) {
    const result = queue.then(async () => {
      try {
        load();
        if (session && Date.parse(session.expiresAt) <= now()) clearAuth();
        const value = await operation();
        return { ok: true, ...value, auth: state() };
      } catch (error) {
        const code = ERROR_CODES.has(error.code) || [
          'INVALID_RESPONSE', 'NETWORK_ERROR', 'REQUEST_TIMEOUT', 'SECURE_STORAGE_UNAVAILABLE',
          'STORAGE_ERROR', 'ALREADY_SIGNED_IN', 'NO_CHALLENGE',
          'ROUTE_UNAVAILABLE',
        ].includes(error.code) ? error.code : 'STORAGE_ERROR';
        log('warn', 'Authentication operation failed.', { code });
        return { ok: false, code, retryAfterSeconds: error.retryAfterSeconds, auth: state() };
      }
    });
    queue = result.then(() => undefined);
    return result;
  }

  return {
    getState: () => run(async () => ({})),
    requestCode: (input) => run(async () => {
      if (!exactInput(input, ['email']) || typeof input.email !== 'string') throw authError('INVALID_REQUEST');
      const email = input.email.trim().toLowerCase();
      if (email.length > 254 || !EMAIL.test(email)) throw authError('INVALID_REQUEST');
      if (token) throw authError('ALREADY_SIGNED_IN');
      if (now() < requestAllowedAt) throw authError('RATE_LIMITED', Math.ceil((requestAllowedAt - now()) / 1000));
      // Once a resend starts, the prior code may already be invalidated even if the response is lost.
      challenge = null;
      const payload = await request('POST', '/api/v1/auth/request-code', { email, installationId: getInstallationId() }, 202)
        .catch((error) => {
          if (error.retryAfterSeconds !== undefined) requestAllowedAt = now() + error.retryAfterSeconds * 1000;
          throw error;
        });
      if (!UUID.test(payload?.challengeId) || !isDate(payload.expiresAt)
        || Date.parse(payload.expiresAt) <= now() || payload.resendAfterSeconds !== 60) throw authError('INVALID_RESPONSE');
      challenge = { id: payload.challengeId, email, expiresAt: payload.expiresAt };
      requestAllowedAt = now() + 60000;
      return {};
    }),
    verifyCode: (input) => run(async () => {
      if (!exactInput(input, ['code']) || typeof input.code !== 'string' || !/^[0-9]{6}$/.test(input.code)) {
        throw authError('INVALID_REQUEST');
      }
      if (!challenge) throw authError('NO_CHALLENGE');
      if (now() < verifyAllowedAt) throw authError('RATE_LIMITED', Math.ceil((verifyAllowedAt - now()) / 1000));
      if (Date.parse(challenge.expiresAt) <= now()) {
        challenge = null;
        throw authError('CODE_EXPIRED');
      }
      const payload = await request('POST', '/api/v1/auth/verify-code', {
        challengeId: challenge.id, installationId: getInstallationId(), code: input.code,
      }, 200).catch((error) => {
        if (['CODE_EXPIRED', 'CODE_ATTEMPTS_EXCEEDED'].includes(error.code)) challenge = null;
        if (error.retryAfterSeconds !== undefined) {
          requestAllowedAt = now() + error.retryAfterSeconds * 1000;
          verifyAllowedAt = requestAllowedAt;
        }
        throw error;
      });
      if (!validToken(payload?.token) || !isDate(payload.expiresAt) || Date.parse(payload.expiresAt) <= now()
        || !isAccount(payload.account) || payload.account.email !== challenge.email
        || !validSession(payload.session, false)) throw authError('INVALID_RESPONSE');
      token = payload.token;
      account = payload.account;
      session = { id: payload.session.id, installationId: payload.session.installationId, expiresAt: payload.expiresAt };
      confirmed = true;
      challenge = null;
      persist();
      return {};
    }),
    refresh: () => run(async () => {
      if (!token) return {};
      confirmed = false;
      const payload = await request('GET', '/api/v1/account', undefined, 200, true);
      if (!isAccount(payload?.account) || payload.account.id !== account.id || payload.account.email !== account.email
        || !validSession(payload.session) || payload.session.id !== session.id
        || payload.session.expiresAt !== session.expiresAt || Date.parse(payload.session.expiresAt) <= now()) {
        throw authError('INVALID_RESPONSE');
      }
      account = payload.account;
      confirmed = true;
      return {};
    }),
    logout: () => run(async () => {
      if (!token) return { revoked: false };
      await request('POST', '/api/v1/auth/logout', undefined, 204, true);
      clearAuth();
      challenge = null;
      return { revoked: true };
    }),
    signOutLocal: () => run(async () => {
      clearAuth();
      challenge = null;
      return { revoked: false, localOnly: true };
    }),
  };
}

function registerAuthIpc(ipcMain, { auth, isTrustedSender, log }) {
  for (const [channel, method] of [
    ['auth:getState', 'getState'], ['auth:requestCode', 'requestCode'],
    ['auth:verifyCode', 'verifyCode'], ['auth:refresh', 'refresh'],
    ['auth:logout', 'logout'], ['auth:signOutLocal', 'signOutLocal'],
  ]) {
    ipcMain.handle(channel, (event, input) => {
      if (!isTrustedSender(event)) {
        log('warn', 'Untrusted authentication IPC blocked.', { channel });
        throw new Error('Untrusted authentication IPC sender.');
      }
      return auth[method](input);
    });
  }
}

module.exports = { createAuth, registerAuthIpc };
