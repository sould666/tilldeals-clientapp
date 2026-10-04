const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const backend = require('../src/backend');

function loadAccount(seed = {}) {
  const files = new Map(Object.entries(seed).map(([name, value]) => [
    path.join('/test-user-data', name), typeof value === 'string' ? value : JSON.stringify(value),
  ]));
  const handlers = new Map();
  const requests = [];
  const logs = [];
  const reads = [];
  const identityPart = async () => ({});
  const context = {
    module: { exports: {} },
    process: { platform: 'linux', env: {} },
    setInterval: () => { throw new Error('Business polling must not start in Phase 0.'); },
    clearInterval: () => {},
    fetch: () => { throw new Error('Business network request must not run.'); },
    require: (name) => {
      if (name === 'electron') return {
        app: { getPath: () => '/test-user-data', getVersion: () => '0.9.19', isPackaged: true },
        safeStorage: {
          isEncryptionAvailable: () => true,
          decryptString: (value) => String(value),
          encryptString: (value) => value,
        },
        shell: { openExternal: () => { throw new Error('Checkout/consultation must not open a browser.'); } },
      };
      if (name === 'node:fs') return {
        existsSync: (file) => files.has(file),
        readFileSync: (file) => { reads.push(file); return files.get(file); },
        writeFileSync: (file, value) => files.set(file, value),
      };
      if (name === 'systeminformation') return {
        uuid: identityPart, system: identityPart, baseboard: identityPart, cpu: identityPart, osInfo: identityPart,
      };
      if (name === './backend') return {
        ...backend,
        checkHealth: () => backend.checkHealth({
          fetchImpl: async (url, options) => {
            requests.push({ url, options });
            return Response.json({
              status: 'ok', release: 'phase-0',
              runtime: { node: '24.10.0', mode: 'production' },
              checks: { environment: 'ok', pg: 'ok', drizzle: 'ok', migration: 'ok' },
            });
          },
        }),
      };
      if (name === 'node:path' || name === 'node:crypto') return require(name);
      throw new Error(`Unexpected dependency: ${name}`);
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/account.js'), 'utf8'), context);
  context.module.exports.registerAccountIpc(
    { handle: (name, handler) => handlers.set(name, handler) },
    { writeLog: (...args) => logs.push(args), summarizeHardware: () => { throw new Error('No hardware upload.'); }, broadcast: () => {} },
  );
  return {
    invoke: (name, ...args) => handlers.get(name)(null, ...args),
    files, requests, reads, logs,
  };
}

test('onboarding, profile editing and tracking remain local; remote actions fail explicitly', async () => {
  const account = loadAccount();
  const invalid = await account.invoke('account:saveProfile', { email: 'invalid', displayName: 'Local' });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.field, 'email');
  const input = { email: 'local@example.test', displayName: 'Local', acceptTerms: true };
  const saved = await account.invoke('account:saveProfile', input);
  assert.equal(saved.ok, true);
  assert.equal(saved.synced, false);
  assert.equal(saved.code, 'BACKEND_UNAVAILABLE');
  const state = await account.invoke('account:getState');
  assert.equal(state.profileComplete, true);
  assert.equal(state.profile.email, input.email);
  assert.equal(state.backend.businessApisAvailable, false);
  assert.equal(state.backend.health.status, 'unchecked');
  const added = await account.invoke('tilldeals:addTrackedItems', [{ name: 'DDR4 RAM', category: 'ram' }], 'manual');
  assert.equal(added.ok, true);
  assert.equal(added.synced, false);
  const removed = await account.invoke('tilldeals:removeTrackedItem', added.items[0].id);
  assert.equal(removed.ok, true);
  assert.equal(removed.items.length, 0);
  for (const [method, args] of [
    ['account:refreshEntitlements', []],
    ['billing:checkout', ['tracking_slot', 1]],
    ['consultation:request', [{ message: 'Help', includeHardware: true }]],
  ]) {
    const result = await account.invoke(method, ...args);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'BACKEND_UNAVAILABLE');
    assert.ok(result.message);
  }
  assert.equal(account.requests.length, 0);
  assert.ok(account.logs.some((entry) => entry[1] === 'Unsupported TillDeals business request blocked.'));
  const health = await account.invoke('account:checkBackendHealth');
  assert.equal(health.health.status, 'ok');
  assert.equal(health.businessApisAvailable, false);
  assert.equal(account.requests.length, 1);
  assert.equal(account.requests[0].url, 'https://deals.tillgreen.eu/api/health');
  assert.deepEqual(account.requests[0].options.headers, { Accept: 'application/json' });
});

test('previously synced profiles/tokens/cache cannot enable business calls or polling', async () => {
  const account = loadAccount({
    'profile.json': { email: 'local@example.test', displayName: 'Local', acceptedTermsAt: '2026-01-01T00:00:00Z', syncedAt: '2026-01-01T00:00:00Z' },
    'device-token.bin': 'test-token-not-a-real-credential',
    'tilldeals-tracked-items.json': [{ id: 'old-item', name: 'RAM', category: 'ram', source: 'manual' }],
    'mydeals-cache.json': { fetchedAt: '2026-01-01T00:00:00Z', deals: [{ id: 'cached-deal', trackedItemId: 'old-item', title: 'Cached', url: 'https://example.test/deal' }] },
  });
  const deals = await account.invoke('mydeals:get');
  assert.equal(deals.deals.length, 1);
  assert.equal(deals.deals[0].hasLink, true);
  assert.equal(deals.nextRefreshAt, null);
  assert.equal(deals.backend.businessApisAvailable, false);
  await account.invoke('tilldeals:addTrackedItems', [{ name: 'SSD', category: 'drives' }], 'manual');
  await account.invoke('tilldeals:removeTrackedItem', 'old-item');
  await account.invoke('account:checkBackendHealth');
  assert.equal(account.requests.length, 1);
  assert.equal(account.reads.some((file) => file.endsWith('device-token.bin')), false);
});

test('local tracking limits, refresh options and encrypted entitlement cache remain unchanged', async () => {
  const account = loadAccount();
  const entries = ['A', 'B', 'C', 'D'].map((name) => ({ name, category: 'other' }));
  assert.equal((await account.invoke('tilldeals:addTrackedItems', entries, 'manual')).ok, true);
  const limit = await account.invoke('tilldeals:addTrackedItems', [{ name: 'E' }], 'manual');
  assert.equal(limit.code, 'PAYMENT_REQUIRED');
  assert.equal(limit.limit, 4);
  assert.equal(limit.backendAvailable, false);
  assert.equal((await account.invoke('mydeals:setRefreshInterval', 12)).ok, true);
  assert.equal((await account.invoke('mydeals:setRefreshInterval', 1)).code, 'PAYMENT_REQUIRED');
  const cached = loadAccount({ 'entitlements.bin': { trackedItemLimit: 8, aiService: true, refreshHours: [12, 6], consultationCredits: 1 } });
  const state = await cached.invoke('account:getState');
  assert.equal(state.entitlements.trackedItemLimit, 8);
  assert.equal(state.entitlements.aiService, true);
  assert.equal(state.backend.businessApisAvailable, false);
});
