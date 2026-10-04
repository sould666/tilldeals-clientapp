let trackedSyncState = null;
let trackedSyncBusy = false;

function renderTrackedSync() {
  if (!trackedSyncState) return;
  const detail = trackedSyncState.status === 'error'
    ? t(`sync.error.${trackedSyncState.code}`) === `sync.error.${trackedSyncState.code}`
      ? t(`auth.error.${trackedSyncState.code}`) : t(`sync.error.${trackedSyncState.code}`)
    : '';
  document.querySelector('#tracked-sync-status').textContent = t(`sync.${trackedSyncState.status}`, {
    date: trackedSyncState.syncedAt ? new Date(trackedSyncState.syncedAt).toLocaleString() : '',
    message: detail,
  }) + (trackedSyncState.retryAfterSeconds ? ` ${t('auth.retry', { seconds: trackedSyncState.retryAfterSeconds })}` : '');
  document.querySelector('#tracked-sync-retry').disabled = trackedSyncBusy || ['signedOut', 'syncing'].includes(trackedSyncState.status);
}

window.trackedSync.onChanged((state) => { trackedSyncState = state; renderTrackedSync(); });
document.querySelector('#tracked-sync-retry').addEventListener('click', async () => {
  trackedSyncBusy = true;
  renderTrackedSync();
  try {
    trackedSyncState = await window.trackedSync.retry();
  } catch {
    window.hardware.log('error', 'Tracked-product sync IPC failed.');
    trackedSyncState = { status: 'error', code: 'IPC_ERROR' };
  } finally {
    trackedSyncBusy = false;
    renderTrackedSync();
  }
});
window.addEventListener('localechange', renderTrackedSync);
window.trackedSync.getState().then((state) => {
  trackedSyncState = state;
  renderTrackedSync();
}).catch(() => {
  window.hardware.log('error', 'Could not read tracked-product sync state.');
  trackedSyncState = { status: 'error', code: 'IPC_ERROR' };
  renderTrackedSync();
});
