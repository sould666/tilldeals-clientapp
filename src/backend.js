const HEALTH_URL = 'https://deals.tillgreen.eu/api/health';
const BUSINESS_APIS_AVAILABLE = false;

function unavailableResult() {
  return {
    ok: false,
    code: 'BACKEND_UNAVAILABLE',
    message: 'TillDeals health and email-code authentication are available separately. Profile/item sync, plans, deals, payments and consultations are not available yet.',
  };
}

function isHealthyPayload(payload) {
  return payload?.status === 'ok'
    && typeof payload.release === 'string'
    && typeof payload.runtime?.node === 'string'
    && payload.runtime.node.startsWith('24.')
    && payload.runtime.mode === 'production'
    && ['environment', 'pg', 'drizzle', 'migration'].every((name) => payload.checks?.[name] === 'ok');
}

async function checkHealth({ fetchImpl = globalThis.fetch, timeoutMs = 15000 } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(HEALTH_URL, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      signal: controller.signal,
    });
    const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    if (contentType !== 'application/json') throw new Error('TillDeals health returned a non-JSON response.');
    const payload = await response.json();
    if (response.status === 503 && payload?.status === 'error') {
      throw new Error('TillDeals health reports the service is unavailable (503).');
    }
    if (response.status !== 200 || !isHealthyPayload(payload)) {
      throw new Error(`TillDeals health returned an invalid response (HTTP ${response.status}).`);
    }
    return { status: 'ok', release: payload.release, checkedAt: new Date().toISOString() };
  } catch (error) {
    return {
      status: 'error',
      message: controller.signal.aborted ? 'TillDeals health request timed out.' : error.message,
      checkedAt: new Date().toISOString(),
    };
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { BUSINESS_APIS_AVAILABLE, checkHealth, unavailableResult };
