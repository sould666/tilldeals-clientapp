let updateState = null;
let updateActionPending = false;
let updateIpcFailed = false;

function renderUpdateState() {
  if (!updateState) return;
  const status = document.querySelector('#app-update-status');
  status.textContent = updateIpcFailed ? t('updates.ipcFailed') : t(`updates.${updateState.status}`, {
    current: updateState.currentVersion,
    latest: updateState.latestVersion || '',
    percent: updateState.percent,
    code: updateState.error || '',
  });
  if (updateState.status === 'unsupported') status.textContent += ` ${t(`updates.unsupported.${updateState.unsupportedReason}`)}`;
  const button = document.querySelector('#app-update-button');
  const ready = updateState.status === 'downloaded';
  const available = updateState.latestVersion && ['available', 'error'].includes(updateState.status);
  button.textContent = t(ready ? 'updates.install' : available ? 'updates.download' : 'updates.check');
  button.disabled = updateActionPending || ['checking', 'downloading', 'installing', 'unsupported'].includes(updateState.status);
}

window.updates.onChanged((state) => {
  updateState = state;
  updateIpcFailed = false;
  renderUpdateState();
});
document.querySelector('#app-update-button').addEventListener('click', async () => {
  if (!updateState || updateActionPending) return;
  updateActionPending = true;
  updateIpcFailed = false;
  renderUpdateState();
  try {
    updateState = updateState.status === 'downloaded' ? await window.updates.install()
      : updateState.latestVersion && ['available', 'error'].includes(updateState.status) ? await window.updates.download()
        : await window.updates.check();
  } catch {
    updateIpcFailed = true;
    window.hardware.log('error', 'Desktop update IPC operation failed.');
  } finally {
    updateActionPending = false;
    renderUpdateState();
  }
});
window.addEventListener('localechange', renderUpdateState);
window.updates.getState().then((state) => {
  updateState = state;
  renderUpdateState();
}).catch(() => {
  window.hardware.log('error', 'Could not read desktop update state.');
  document.querySelector('#app-update-status').textContent = t('updates.ipcFailed');
});
