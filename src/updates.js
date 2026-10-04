function createUpdates({ updater, currentVersion, supported, unsupportedReason, log, broadcast }) {
  let state = {
    status: supported ? 'idle' : 'unsupported',
    currentVersion,
    latestVersion: null,
    percent: 0,
    error: null,
    unsupportedReason: supported ? null : unsupportedReason,
  };
  let active = false;

  function publish(changes) {
    state = { ...state, ...changes };
    broadcast('updates:changed', { ...state });
  }

  function failure(error) {
    const code = typeof error?.code === 'string' ? error.code : 'UPDATE_FAILED';
    log('warn', 'Desktop update operation failed.', { code });
    publish({ status: 'error', error: code });
  }

  if (supported) {
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowPrerelease = false;
    updater.allowDowngrade = false;
    // The installer is currently unsigned; checksum verification is provided by electron-updater.
    updater.logger = {
      info: () => {},
      debug: () => {},
      warn: () => log('warn', 'Desktop updater reported a warning.'),
      error: () => log('warn', 'Desktop updater reported an error.'),
    };
    updater.on('error', failure);
    updater.on('checking-for-update', () => publish({ status: 'checking', error: null }));
    updater.on('update-available', (info) => publish({ status: 'available', latestVersion: info.version, percent: 0, error: null }));
    updater.on('update-not-available', () => publish({ status: 'current', latestVersion: null, error: null }));
    updater.on('download-progress', (progress) => publish({
      percent: Number.isFinite(progress.percent) ? Math.min(100, Math.max(0, Math.floor(progress.percent))) : 0,
    }));
    updater.on('update-downloaded', (info) => publish({ status: 'downloaded', latestVersion: info.version, percent: 100, error: null }));
  }

  return {
    getState: () => ({ ...state }),
    check: async () => {
      if (!supported || active || ['downloaded', 'installing'].includes(state.status)) return { ...state };
      active = true;
      publish({ status: 'checking', latestVersion: null, error: null });
      try {
        await updater.checkForUpdates();
      } catch (error) {
        failure(error);
      } finally {
        active = false;
      }
      return { ...state };
    },
    download: async () => {
      if (!supported || active || !['available', 'error'].includes(state.status) || !state.latestVersion) {
        throw new Error('No desktop update is available for download.');
      }
      active = true;
      publish({ status: 'downloading', percent: 0, error: null });
      try {
        await updater.downloadUpdate();
      } catch (error) {
        failure(error);
      } finally {
        active = false;
      }
      return { ...state };
    },
    install: () => {
      if (!supported || active || state.status !== 'downloaded') throw new Error('No verified update is ready to install.');
      publish({ status: 'installing', error: null });
      try {
        updater.quitAndInstall(false, true);
      } catch (error) {
        failure(error);
      }
      return { ...state };
    },
  };
}

function registerUpdatesIpc(ipcMain, { updates, isTrustedSender, log }) {
  for (const [channel, method] of [
    ['updates:getState', 'getState'], ['updates:check', 'check'],
    ['updates:download', 'download'], ['updates:install', 'install'],
  ]) {
    ipcMain.handle(channel, (event) => {
      if (!isTrustedSender(event)) {
        log('warn', 'Untrusted update IPC blocked.', { channel });
        throw new Error('Untrusted update IPC sender.');
      }
      return updates[method]();
    });
  }
}

module.exports = { createUpdates, registerUpdatesIpc };
