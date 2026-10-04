const { app, safeStorage, shell } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const si = require('systeminformation');
const backend = require('./backend');

const CHECKOUT_HOSTS = new Set(['deals.tillgreen.eu', 'checkout.stripe.com', 'billing.stripe.com']);
const BILLING_PRODUCTS = new Set(['tracking_slot', 'ai_service', 'refresh_interval', 'consultation']);
const FREE_TRACKED_LIMIT = 4;
const FREE_REFRESH_HOURS = 12;
const REFRESH_OPTIONS_HOURS = [12, 6, 3, 1];
const TERMS_VERSION = '1';
const MACHINE_KEY_SALT = 'tilldeals-hardware-machine-key-v1';
const DEALS_RETRY_AFTER_FAILURE_MS = 15 * 60 * 1000;
const DEALS_SCHEDULER_TICK_MS = 60 * 1000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TRACKED_CATEGORIES = new Set(['processor', 'motherboard', 'ram', 'drives', 'monitor', 'graphics', 'other']);

let log = () => {};
let machineIdentity = null;
let lastDealsAttemptAt = 0;
let dealsTimer = null;
let health = { status: 'unchecked', checkedAt: null };
let trackedSync = null;

function backendState() {
  return { businessApisAvailable: backend.BUSINESS_APIS_AVAILABLE, health };
}

async function checkBackendHealth() {
  health = await backend.checkHealth();
  log(health.status === 'ok' ? 'info' : 'warn', 'TillDeals health check completed.', health);
  return backendState();
}

function dataPath(name) {
  return path.join(app.getPath('userData'), name);
}

function readJson(name, fallback) {
  const filePath = dataPath(name);
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    log('error', `Could not read ${name}.`, { message: error.message });
    return fallback;
  }
}

function writeJson(name, value) {
  fs.writeFileSync(dataPath(name), JSON.stringify(value));
}

// Encrypted at rest so local edits cannot unlock paid features; the server stays authoritative.
function readSecure(name) {
  const filePath = dataPath(name);
  if (!fs.existsSync(filePath) || !safeStorage.isEncryptionAvailable()) return null;
  try {
    return safeStorage.decryptString(fs.readFileSync(filePath));
  } catch (error) {
    log('error', `Could not decrypt ${name}.`, { message: error.message });
    return null;
  }
}

function writeSecure(name, value) {
  if (!safeStorage.isEncryptionAvailable()) return;
  fs.writeFileSync(dataPath(name), safeStorage.encryptString(value));
}

// Hardware + OS identifiers only; IP is deliberately excluded because it changes with the network.
async function computeMachineIdentity() {
  const [uuid, system, baseboard, cpu, osInfo] = await Promise.all([
    si.uuid(), si.system(), si.baseboard(), si.cpu(), si.osInfo(),
  ]);
  const parts = [
    uuid.hardware, uuid.os, system.uuid, system.serial, baseboard.serial, baseboard.model,
    cpu.brand, osInfo.platform, osInfo.arch,
  ].map((value) => String(value || '').trim().toLowerCase());
  return {
    machineKey: crypto.createHash('sha256').update(`${MACHINE_KEY_SALT}|${parts.join('|')}`).digest('hex'),
    isVirtual: Boolean(system.virtual),
    virtualHost: system.virtualHost || null,
  };
}

async function getMachineIdentity() {
  if (machineIdentity) return machineIdentity;
  const computed = await computeMachineIdentity();
  const stored = readJson('machine.json', null);
  machineIdentity = { ...computed, previousMachineKey: null };
  if (!stored) {
    writeJson('machine.json', { machineKey: computed.machineKey, createdAt: new Date().toISOString() });
    log('info', 'Machine key created on first run.', { isVirtual: computed.isVirtual });
  } else if (stored.machineKey !== computed.machineKey) {
    // Hardware/OS changed or the profile folder was copied to another machine.
    machineIdentity.previousMachineKey = stored.machineKey;
    writeJson('machine.json', { machineKey: computed.machineKey, createdAt: new Date().toISOString(), previousMachineKey: stored.machineKey });
    log('warn', 'Machine key changed since last run.', { isVirtual: computed.isVirtual });
  }
  return machineIdentity;
}

function loadProfile() {
  return readJson('profile.json', null);
}

function isProfileComplete(profile) {
  return Boolean(profile && EMAIL_PATTERN.test(profile.email || '') && profile.displayName && profile.acceptedTermsAt);
}

function defaultEntitlements() {
  return { trackedItemLimit: FREE_TRACKED_LIMIT, aiService: false, refreshHours: [FREE_REFRESH_HOURS], consultationCredits: 0 };
}

function normalizeEntitlements(raw) {
  const refreshHours = Array.isArray(raw?.refreshHours)
    ? raw.refreshHours.map(Number).filter((hours) => REFRESH_OPTIONS_HOURS.includes(hours))
    : [];
  return {
    trackedItemLimit: Math.max(FREE_TRACKED_LIMIT, Number.isInteger(raw?.trackedItemLimit) ? raw.trackedItemLimit : 0),
    aiService: raw?.aiService === true,
    refreshHours: Array.from(new Set([FREE_REFRESH_HOURS, ...refreshHours])),
    consultationCredits: Number.isInteger(raw?.consultationCredits) ? raw.consultationCredits : 0,
  };
}

function loadEntitlements() {
  const raw = readSecure('entitlements.bin');
  if (!raw) return defaultEntitlements();
  try {
    return normalizeEntitlements(JSON.parse(raw));
  } catch (_error) {
    return defaultEntitlements();
  }
}

function saveEntitlements(raw) {
  const entitlements = normalizeEntitlements(raw);
  writeSecure('entitlements.bin', JSON.stringify({ ...entitlements, fetchedAt: new Date().toISOString() }));
  return entitlements;
}

function canUseAi() {
  if (!app.isPackaged && process.env.TILLDEALS_DEV_UNLOCK === '1') return true;
  return loadEntitlements().aiService;
}

function paymentRequired(product, message) {
  return { ok: false, code: 'PAYMENT_REQUIRED', product, message, backendAvailable: backend.BUSINESS_APIS_AVAILABLE };
}

async function apiRequest(method, pathname) {
  const result = backend.unavailableResult();
  log('info', 'Unsupported TillDeals business request blocked.', { method, pathname });
  const error = new Error(result.message);
  error.code = result.code;
  throw error;
}

async function syncProfile() {
  if (!backend.BUSINESS_APIS_AVAILABLE) return backend.unavailableResult();
  const profile = loadProfile();
  if (!isProfileComplete(profile)) return { ok: false, message: 'Profile is incomplete.' };
  const identity = await getMachineIdentity();
  try {
    const result = await apiRequest('POST', '/devices/register', {
      machineKey: identity.machineKey,
      previousMachineKey: identity.previousMachineKey,
      isVirtual: identity.isVirtual,
      virtualHost: identity.virtualHost,
      platform: process.platform,
      appVersion: app.getVersion(),
      profile: {
        email: profile.email,
        displayName: profile.displayName,
        acceptedTermsAt: profile.acceptedTermsAt,
        termsVersion: profile.termsVersion,
      },
    });
    if (result?.deviceToken) writeSecure('device-token.bin', String(result.deviceToken));
    if (result?.entitlements) saveEntitlements(result.entitlements);
    writeJson('profile.json', { ...profile, accountId: result?.accountId ?? profile.accountId ?? null, syncedAt: new Date().toISOString(), syncError: null });
    log('info', 'Profile synced with TillDeals web app.');
    await pushTrackedItems(loadTrackedItems());
    return { ok: true };
  } catch (error) {
    writeJson('profile.json', { ...profile, syncError: error.message });
    log('warn', 'Profile sync failed.', { message: error.message, status: error.status });
    return { ok: false, message: error.message, code: error.code };
  }
}

async function saveProfile(input) {
  const existing = loadProfile() || {};
  const email = String(input?.email || '').trim().slice(0, 254);
  const displayName = String(input?.displayName || '').trim().slice(0, 80);
  if (!EMAIL_PATTERN.test(email)) return { ok: false, field: 'email', message: 'Enter a valid email address.' };
  if (!displayName) return { ok: false, field: 'displayName', message: 'Enter a display name.' };
  if (!existing.acceptedTermsAt && input?.acceptTerms !== true) {
    return { ok: false, field: 'acceptTerms', message: 'You must accept the terms and privacy policy.' };
  }
  const changed = email !== existing.email || displayName !== existing.displayName;
  writeJson('profile.json', {
    ...existing,
    email,
    displayName,
    acceptedTermsAt: existing.acceptedTermsAt || new Date().toISOString(),
    termsVersion: existing.termsVersion || TERMS_VERSION,
    createdAt: existing.createdAt || new Date().toISOString(),
    syncedAt: changed ? null : existing.syncedAt,
  });
  const sync = await syncProfile();
  return { ok: true, synced: sync.ok, message: sync.message, code: sync.code };
}

async function getAccountState() {
  const identity = await getMachineIdentity();
  const profile = loadProfile();
  return {
    profile: profile ? { email: profile.email, displayName: profile.displayName, syncedAt: profile.syncedAt || null, syncError: profile.syncError || null } : null,
    profileComplete: isProfileComplete(profile),
    machineKeyShort: identity.machineKey.slice(0, 12),
    isVirtual: identity.isVirtual,
    entitlements: loadEntitlements(),
    trackedCount: loadTrackedItems().length,
    backend: backendState(),
  };
}

async function refreshEntitlements() {
  try {
    const result = await apiRequest('GET', '/account/entitlements');
    return { ok: true, entitlements: saveEntitlements(result) };
  } catch (error) {
    return { ok: false, code: error.code, message: error.message, entitlements: loadEntitlements() };
  }
}

function loadTrackedItems() {
  const stored = readJson('tilldeals-tracked-items.json', []);
  if (!Array.isArray(stored)) return [];
  // Earlier versions stored grouped entries ({ items: [...] }); flatten them into single items.
  let migrated = false;
  const items = stored.flatMap((entry) => {
    if (Array.isArray(entry?.items)) {
      return entry.items.map((name, index) => ({
        id: `${entry.id || Date.now()}-${index}`,
        name: String(name),
        category: String(entry.key || '').replace(/^proposal-\d+-/, '') || 'other',
        source: 'ai',
        addedAt: entry.addedAt || new Date().toISOString(),
      }));
    }
    return entry?.name ? [entry] : [];
  }).map((item) => {
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(item.id)) return item;
    migrated = true;
    return { ...item, id: crypto.randomUUID() };
  });
  if (migrated) saveTrackedItems(items);
  return items;
}

function saveTrackedItems(items) {
  writeJson('tilldeals-tracked-items.json', items);
}

async function pushTrackedItems(items) {
  if (trackedSync) {
    await trackedSync.sync();
    return trackedSync.getState().status === 'synced';
  }
  return false;
}

async function addTrackedItems(entries, source) {
  const stored = loadTrackedItems();
  const known = new Set(stored.map((item) => item.name.toLowerCase()));
  const timestamp = new Date().toISOString();
  const additions = [];
  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    const name = String(entry?.name || '').trim().slice(0, 200);
    if (!name || known.has(name.toLowerCase())) return;
    known.add(name.toLowerCase());
    additions.push({
      id: crypto.randomUUID(),
      name,
      category: TRACKED_CATEGORIES.has(entry?.category) ? entry.category : 'other',
      source: source === 'manual' ? 'manual' : 'ai',
      addedAt: timestamp,
    });
  });
  if (!additions.length) return { ok: false, code: 'NOTHING_TO_ADD', message: 'These items are already tracked.' };

  const { trackedItemLimit } = loadEntitlements();
  if (stored.length + additions.length > 100) {
    return { ok: false, code: 'ITEM_LIMIT', message: 'This installation supports at most 100 tracked products.' };
  }
  if (stored.length + additions.length > trackedItemLimit) {
    return {
      ...paymentRequired('tracking_slot', `Your plan allows ${trackedItemLimit} tracked items. Buy an extra slot for each additional item.`),
      limit: trackedItemLimit,
      needed: stored.length + additions.length - trackedItemLimit,
    };
  }

  const items = [...stored, ...additions];
  saveTrackedItems(items);
  const synced = await pushTrackedItems(items);
  log('info', 'Tracked items added.', { count: additions.length, source });
  return { ok: true, items, synced };
}

async function removeTrackedItem(id) {
  const stored = loadTrackedItems();
  const items = stored.filter((item) => item.id !== id);
  if (items.length === stored.length) return { ok: false, message: 'Item not found.' };
  saveTrackedItems(items);
  const synced = await pushTrackedItems(items);
  return { ok: true, items, synced };
}

function loadDealsSettings() {
  const settings = readJson('mydeals-settings.json', {});
  return { refreshHours: REFRESH_OPTIONS_HOURS.includes(settings.refreshHours) ? settings.refreshHours : FREE_REFRESH_HOURS };
}

function setRefreshInterval(hours) {
  const value = Number(hours);
  if (!REFRESH_OPTIONS_HOURS.includes(value)) return { ok: false, message: 'Unsupported refresh interval.' };
  if (!loadEntitlements().refreshHours.includes(value)) {
    return paymentRequired('refresh_interval', 'Refresh intervals shorter than 12 hours are a paid feature.');
  }
  writeJson('mydeals-settings.json', { refreshHours: value });
  return { ok: true, refreshHours: value };
}

function loadDealsCache() {
  return readJson('mydeals-cache.json', { deals: [], fetchedAt: null });
}

function effectiveRefreshHours() {
  const { refreshHours } = loadDealsSettings();
  return loadEntitlements().refreshHours.includes(refreshHours) ? refreshHours : FREE_REFRESH_HOURS;
}

async function fetchDealsIfDue(onUpdate) {
  if (!loadProfile()?.syncedAt || !loadTrackedItems().length) return;
  const cache = loadDealsCache();
  const now = Date.now();
  const lastFetched = cache.fetchedAt ? Date.parse(cache.fetchedAt) : 0;
  if (now - lastFetched < effectiveRefreshHours() * 3600 * 1000) return;
  if (now - lastDealsAttemptAt < DEALS_RETRY_AFTER_FAILURE_MS) return;
  lastDealsAttemptAt = now;
  try {
    const result = await apiRequest('GET', '/tracked-items/deals');
    const deals = (Array.isArray(result?.deals) ? result.deals : []).slice(0, 500).map((deal) => ({
      id: String(deal.id || crypto.randomUUID()),
      trackedItemId: String(deal.trackedItemId || ''),
      title: String(deal.title || '').slice(0, 300),
      price: deal.price ?? null,
      currency: String(deal.currency || '').slice(0, 8),
      shop: String(deal.shop || '').slice(0, 120),
      url: typeof deal.url === 'string' && deal.url.startsWith('https://') ? deal.url : null,
      updatedAt: deal.updatedAt || null,
    }));
    const updated = { deals, fetchedAt: new Date().toISOString() };
    writeJson('mydeals-cache.json', updated);
    onUpdate(updated);
  } catch (error) {
    log('warn', 'Deals refresh failed.', { message: error.message, status: error.status });
  }
}

function startDealsScheduler(onUpdate) {
  clearInterval(dealsTimer);
  if (!backend.BUSINESS_APIS_AVAILABLE) return;
  fetchDealsIfDue(onUpdate);
  dealsTimer = setInterval(() => fetchDealsIfDue(onUpdate), DEALS_SCHEDULER_TICK_MS);
}

function getMyDeals() {
  const cache = loadDealsCache();
  const refreshHours = effectiveRefreshHours();
  return {
    items: loadTrackedItems(),
    deals: cache.deals.map(({ url, ...deal }) => ({ ...deal, hasLink: Boolean(url) })),
    fetchedAt: cache.fetchedAt,
    nextRefreshAt: backend.BUSINESS_APIS_AVAILABLE && cache.fetchedAt ? new Date(Date.parse(cache.fetchedAt) + refreshHours * 3600 * 1000).toISOString() : null,
    refreshHours,
    refreshOptions: REFRESH_OPTIONS_HOURS,
    entitlements: loadEntitlements(),
    backend: backendState(),
  };
}

async function openDeal(dealId) {
  const deal = loadDealsCache().deals.find((item) => item.id === dealId);
  if (!deal?.url) return { ok: false, message: 'Deal link is unavailable.' };
  await shell.openExternal(deal.url);
  return { ok: true };
}

async function openTrustedUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch (_error) {
    throw new Error('Server returned an invalid link.');
  }
  if (url.protocol !== 'https:' || !CHECKOUT_HOSTS.has(url.hostname)) {
    throw new Error('Server returned a link to an untrusted host.');
  }
  await shell.openExternal(url.toString());
}

async function startCheckout(product, quantity) {
  if (!backend.BUSINESS_APIS_AVAILABLE) return backend.unavailableResult();
  if (!BILLING_PRODUCTS.has(product)) return { ok: false, message: 'Unknown product.' };
  if (!loadProfile()?.syncedAt) return { ok: false, message: 'Your profile is not synced with TillDeals yet. Check your connection and save your profile again.' };
  try {
    const amount = Math.min(Math.max(Number.parseInt(quantity, 10) || 1, 1), 50);
    const result = await apiRequest('POST', '/billing/checkout', { product, quantity: amount });
    await openTrustedUrl(result?.url);
    log('info', 'Checkout opened.', { product, quantity: amount });
    return { ok: true };
  } catch (error) {
    log('warn', 'Checkout could not be started.', { product, message: error.message });
    return { ok: false, message: error.message };
  }
}

async function requestConsultation(payload, summarizeHardware) {
  if (!backend.BUSINESS_APIS_AVAILABLE) return backend.unavailableResult();
  if (!loadProfile()?.syncedAt) return { ok: false, message: 'Your profile is not synced with TillDeals yet.' };
  const message = String(payload?.message || '').trim().slice(0, 2000);
  if (!message) return { ok: false, message: 'Describe what you need help with.' };
  try {
    const result = await apiRequest('POST', '/consultations', {
      topic: String(payload?.topic || 'other').slice(0, 40),
      message,
      hardware: payload?.includeHardware ? summarizeHardware(payload.hardwareSnapshot) : null,
    });
    await openTrustedUrl(result?.sessionUrl || result?.checkoutUrl);
    return { ok: true, paid: Boolean(result?.sessionUrl) };
  } catch (error) {
    log('warn', 'Consultation request failed.', { message: error.message });
    return { ok: false, message: error.message };
  }
}

function registerAccountIpc(ipcMain, { writeLog, summarizeHardware, broadcast }) {
  log = writeLog;
  getMachineIdentity().then(() => {
    const profile = loadProfile();
    if (backend.BUSINESS_APIS_AVAILABLE && isProfileComplete(profile) && !profile.syncedAt) syncProfile();
  }).catch((error) => writeLog('error', 'Could not compute machine key.', { message: error.message }));

  ipcMain.handle('account:getState', () => getAccountState());
  ipcMain.handle('account:saveProfile', (_event, input) => saveProfile(input));
  ipcMain.handle('account:refreshEntitlements', () => refreshEntitlements());
  ipcMain.handle('account:checkBackendHealth', () => checkBackendHealth());
  ipcMain.handle('billing:checkout', (_event, product, quantity) => startCheckout(product, quantity));
  ipcMain.handle('consultation:request', (_event, payload) => requestConsultation(payload, summarizeHardware));
  ipcMain.handle('tilldeals:getTrackedItems', () => loadTrackedItems());
  ipcMain.handle('tilldeals:addTrackedItems', (_event, entries, source) => addTrackedItems(entries, source));
  ipcMain.handle('tilldeals:removeTrackedItem', (_event, id) => removeTrackedItem(String(id || '')));
  ipcMain.handle('mydeals:get', () => getMyDeals());
  ipcMain.handle('mydeals:setRefreshInterval', (_event, hours) => setRefreshInterval(hours));
  ipcMain.handle('mydeals:openDeal', (_event, dealId) => openDeal(String(dealId || '')));

  startDealsScheduler(() => broadcast('mydeals:updated'));
}

module.exports = { registerAccountIpc, canUseAi, paymentRequired, loadTrackedItems, setTrackedSync: (value) => { trackedSync = value; } };
