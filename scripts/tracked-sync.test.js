const test = require('node:test');
const assert = require('node:assert/strict');
const { createTrackedSync } = require('../src/tracked-sync');

const ID = '11111111-1111-4111-8111-111111111111';
const DATE = '2026-10-04T10:00:00.000Z';
const item = { id: ID, name: 'RAM', category: 'ram', source: 'manual', addedAt: DATE };

function fixture() {
  let context = 'account-session-a';
  let items = [item];
  const calls = [];
  const events = [];
  let responder = async (snapshot) => ({
    ok: true, installationId: ID, payload: { installationId: ID, items: snapshot, syncedAt: DATE },
  });
  const sync = createTrackedSync({
    auth: {
      getContext: () => context,
      putTrackedItems: (snapshot, expectedContext) => {
        calls.push({ snapshot, expectedContext });
        return responder(snapshot);
      },
    },
    readItems: () => items, log: () => {}, broadcast: (_channel, state) => events.push(state),
  });
  return {
    sync, calls, events, setItems: (value) => { items = value; },
    setContext: (value) => { context = value; }, respond: (fn) => { responder = fn; },
  };
}

test('full snapshot and empty list sync only this installation without overwriting local data', async () => {
  const f = fixture();
  await f.sync.sync();
  assert.equal(f.sync.getState().status, 'synced');
  assert.deepEqual(f.calls[0].snapshot, [{ clientId: ID, name: 'RAM', category: 'ram', source: 'manual', addedAt: DATE }]);
  f.setItems([]);
  await f.sync.sync();
  assert.deepEqual(f.calls[1].snapshot, []);
  assert.equal(f.sync.getState().status, 'synced');
});

test('coalesces edits while a request is in flight and serializes newest snapshot', async () => {
  const f = fixture();
  let resolve;
  f.respond(() => new Promise((done) => { resolve = done; }));
  const first = f.sync.sync();
  f.setItems([{ ...item, name: 'SSD' }]);
  f.sync.sync();
  f.setItems([]);
  f.sync.sync();
  assert.equal(f.calls.length, 1);
  f.respond(async (snapshot) => ({ ok: true, installationId: ID, payload: { installationId: ID, items: snapshot, syncedAt: DATE } }));
  resolve({ ok: true, installationId: ID, payload: { installationId: ID, items: f.calls[0].snapshot, syncedAt: DATE } });
  await first;
  assert.equal(f.calls.length, 2);
  assert.deepEqual(f.calls[1].snapshot, []);
  assert.equal(f.events.filter((state) => state.status === 'synced').length, 1);
});

test('ignores old-account results and requires validated auth, with no retry loop', async () => {
  const f = fixture();
  let resolve;
  f.respond(() => new Promise((done) => { resolve = done; }));
  const pending = f.sync.sync();
  f.setContext(null);
  f.sync.authChanged();
  resolve({ ok: true, installationId: ID, payload: { installationId: ID, items: f.calls[0].snapshot, syncedAt: DATE } });
  await pending;
  assert.equal(f.sync.getState().status, 'signedOut');
  await f.sync.sync();
  assert.equal(f.calls.length, 1);
  f.setContext('account-session-b');
  f.respond(async () => ({ ok: false, code: 'ROUTE_UNAVAILABLE' }));
  await f.sync.sync();
  assert.equal(f.sync.getState().code, 'ROUTE_UNAVAILABLE');
  assert.equal(f.calls.length, 2);
});

test('enforces 100 items, UUID uniqueness, UTF-8 byte limit and response installation ownership', async () => {
  const f = fixture();
  f.setItems(Array.from({ length: 101 }, () => item));
  await f.sync.sync();
  assert.equal(f.sync.getState().code, 'ITEM_LIMIT');
  f.setItems([item, item]);
  await f.sync.sync();
  assert.equal(f.sync.getState().code, 'INVALID_LOCAL_ITEMS');
  f.setItems(Array.from({ length: 100 }, (_, index) => ({
    ...item, id: `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`,
    name: '界'.repeat(200), category: '界'.repeat(100), source: '界'.repeat(100),
  })));
  await f.sync.sync();
  assert.equal(f.sync.getState().code, 'PAYLOAD_TOO_LARGE');
  assert.equal(f.calls.length, 0);
  f.setItems([item]);
  f.respond(async (snapshot) => ({ ok: true, installationId: ID, payload: { installationId: 'other', items: snapshot, syncedAt: DATE } }));
  await f.sync.sync();
  assert.equal(f.sync.getState().code, 'INVALID_RESPONSE');
});

test('unreadable local storage reports failure without uploading an empty snapshot', async () => {
  let calls = 0;
  const sync = createTrackedSync({
    auth: { getContext: () => 'validated-session', putTrackedItems: async () => { calls++; } },
    readItems: () => { throw new Error('STORAGE_ERROR'); },
    log: () => {}, broadcast: () => {},
  });
  await sync.sync();
  assert.equal(sync.getState().status, 'error');
  assert.equal(sync.getState().code, 'STORAGE_ERROR');
  assert.equal(calls, 0);
});
