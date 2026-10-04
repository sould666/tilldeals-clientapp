const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UTC_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

function validItems(items) {
  return Array.isArray(items) && items.length <= 100
    && new Set(items.map((item) => item?.clientId)).size === items.length
    && items.every((item) => UUID.test(item?.clientId)
      && [['name', 200], ['category', 100], ['source', 100]].every(([key, max]) =>
        typeof item[key] === 'string' && item[key].length >= 1 && item[key].length <= max && item[key] === item[key].trim())
      && typeof item.addedAt === 'string' && UTC_DATE.test(item.addedAt) && Number.isFinite(Date.parse(item.addedAt)));
}

function createTrackedSync({ auth, readItems, log, broadcast }) {
  let state = { status: 'signedOut', syncedAt: null, code: null };
  let pending = false;
  let running = null;
  let editVersion = 0;
  let ownerContext = null;
  let blockedUntil = 0;

  function publish(next) {
    state = next;
    broadcast('tracked-sync:changed', { ...state });
  }

  function authChanged() {
    const context = auth.getContext();
    if (context !== ownerContext) {
      ownerContext = context;
      blockedUntil = 0;
      publish({ status: context ? 'idle' : 'signedOut', syncedAt: null, code: null });
    }
  }

  async function drain() {
    while (pending) {
      pending = false;
      authChanged();
      const context = auth.getContext();
      if (!context) return;
      if (Date.now() < blockedUntil) {
        publish({ status: 'error', code: 'RATE_LIMITED', retryAfterSeconds: Math.ceil((blockedUntil - Date.now()) / 1000), syncedAt: null });
        return;
      }
      const version = editVersion;
      try {
        const items = readItems().map(({ id, name, category, source, addedAt }) => ({ clientId: id, name, category, source, addedAt }));
        const code = items.length > 100 ? 'ITEM_LIMIT' : !validItems(items) ? 'INVALID_LOCAL_ITEMS'
          : Buffer.byteLength(JSON.stringify({ items }), 'utf8') > 65536 ? 'PAYLOAD_TOO_LARGE' : null;
        if (code) {
          log('warn', 'Tracked-product snapshot cannot be synced.', { code });
          publish({ status: 'error', code, syncedAt: null });
          continue;
        }
        publish({ status: 'syncing', code: null, syncedAt: null });
        const result = await auth.putTrackedItems(items, context);
        if (auth.getContext() !== context || editVersion !== version) continue;
        if (!result.ok) {
          if (Number.isSafeInteger(result.retryAfterSeconds) && result.retryAfterSeconds > 0) {
            blockedUntil = Date.now() + result.retryAfterSeconds * 1000;
          }
          log('warn', 'Tracked-product sync failed.', { code: result.code });
          publish({ status: 'error', code: result.code, retryAfterSeconds: result.retryAfterSeconds, syncedAt: null });
          continue;
        }
        const payload = result.payload;
        const byId = new Map(items.map((item) => [item.clientId, item]));
        if (payload?.installationId !== result.installationId || !validItems(payload.items)
          || payload.items.length !== items.length || !UTC_DATE.test(payload.syncedAt)
          || !Number.isFinite(Date.parse(payload.syncedAt))
          || payload.items.some((item) => {
            const expected = byId.get(item.clientId);
            return !expected || ['name', 'category', 'source', 'addedAt'].some((key) => item[key] !== expected[key]);
          })) {
          log('warn', 'Tracked-product sync response failed validation.', { code: 'INVALID_RESPONSE' });
          publish({ status: 'error', code: 'INVALID_RESPONSE', syncedAt: null });
          continue;
        }
        publish({ status: 'synced', code: null, syncedAt: payload.syncedAt });
      } catch {
        log('error', 'Could not prepare tracked-product sync.', { code: 'STORAGE_ERROR' });
        if (auth.getContext() === context && editVersion === version) publish({ status: 'error', code: 'STORAGE_ERROR', syncedAt: null });
      }
    }
  }

  function sync() {
    editVersion++;
    pending = true;
    if (!running) running = drain().finally(() => {
      running = null;
      if (pending) sync();
    });
    return running;
  }

  return { sync, authChanged, getState: () => ({ ...state }) };
}

module.exports = { createTrackedSync, validItems };
