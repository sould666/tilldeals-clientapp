const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable, Writable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { NsisUpdater } = require('electron-updater');
const { DigestTransform } = require('builder-util-runtime');
const { createUpdates, registerUpdatesIpc } = require('../src/updates');

function fixture(supported = true) {
  const updater = new EventEmitter();
  const events = [];
  const logs = [];
  const calls = { checks: 0, downloads: 0, installs: [] };
  updater.checkForUpdates = async () => {
    calls.checks++;
    updater.emit('update-available', { version: '0.10.0' });
  };
  updater.downloadUpdate = async () => {
    calls.downloads++;
    updater.emit('download-progress', { percent: 43.8 });
    updater.emit('update-downloaded', { version: '0.10.0' });
  };
  updater.quitAndInstall = (...args) => calls.installs.push(args);
  const updates = createUpdates({
    updater: supported ? updater : null, currentVersion: '0.9.19', supported,
    unsupportedReason: 'development', log: (...args) => logs.push(args),
    broadcast: (channel, state) => events.push({ channel, state }),
  });
  return { updates, updater, calls, events, logs };
}

test('launch check discovers update without downloading/installing; explicit download then restart', async () => {
  const f = fixture();
  assert.equal(f.updater.autoDownload, false);
  assert.equal(f.updater.autoInstallOnAppQuit, false);
  assert.equal(f.updater.allowPrerelease, false);
  assert.equal(f.updater.allowDowngrade, false);
  assert.equal((await f.updates.check()).status, 'available');
  assert.equal(f.calls.checks, 1);
  assert.equal(f.calls.downloads, 0);
  assert.equal(f.calls.installs.length, 0);
  const downloaded = await f.updates.download();
  assert.equal(downloaded.status, 'downloaded');
  assert.equal(downloaded.latestVersion, '0.10.0');
  assert.equal(downloaded.percent, 100);
  assert.ok(f.events.some(({ state }) => state.status === 'downloading' && state.percent === 43));
  assert.equal(f.calls.installs.length, 0);
  assert.equal(f.updates.install().status, 'installing');
  assert.deepEqual(f.calls.installs, [[false, true]]);
});

test('current release and unsupported platforms do not download', async () => {
  const f = fixture();
  f.updater.checkForUpdates = async () => f.updater.emit('update-not-available', { version: '0.9.19' });
  assert.equal((await f.updates.check()).status, 'current');
  await assert.rejects(f.updates.download(), /No desktop update/);
  assert.throws(() => f.updates.install(), /No verified update/);
  const dev = fixture(false);
  assert.equal((await dev.updates.check()).status, 'unsupported');
  assert.equal(dev.updates.getState().unsupportedReason, 'development');
  await assert.rejects(dev.updates.download(), /No desktop update/);
  assert.equal(dev.calls.checks, 0);
});

test('network/checksum/install errors surface and cannot report a successful update', async () => {
  const f = fixture();
  f.updater.checkForUpdates = async () => { throw Object.assign(new Error('offline'), { code: 'HTTP_ERROR_503' }); };
  const failedCheck = await f.updates.check();
  assert.equal(failedCheck.status, 'error');
  assert.equal(failedCheck.error, 'HTTP_ERROR_503');
  assert.equal(failedCheck.latestVersion, null);
  f.updater.checkForUpdates = async () => f.updater.emit('update-available', { version: '0.10.0' });
  await f.updates.check();
  f.updater.downloadUpdate = async () => { throw Object.assign(new Error('bad hash'), { code: 'ERR_CHECKSUM_MISMATCH' }); };
  const failedDownload = await f.updates.download();
  assert.equal(failedDownload.status, 'error');
  assert.equal(failedDownload.error, 'ERR_CHECKSUM_MISMATCH');
  assert.throws(() => f.updates.install(), /No verified update/);
  f.updater.downloadUpdate = async () => f.updater.emit('update-downloaded', { version: '0.10.0' });
  await f.updates.download();
  f.updater.quitAndInstall = () => f.updater.emit('error', new Error('installer failed'));
  assert.equal(f.updates.install().status, 'error');
  assert.ok(f.logs.length > 0);
});

test('duplicate check/download clicks are serialized; ready download is not discarded by check', async () => {
  const f = fixture();
  let resolveCheck;
  f.updater.checkForUpdates = () => new Promise((resolve) => {
    resolveCheck = () => { f.updater.emit('update-available', { version: '0.10.0' }); resolve(); };
  });
  const checking = f.updates.check();
  assert.equal((await f.updates.check()).status, 'checking');
  resolveCheck();
  await checking;
  let resolveDownload;
  f.updater.downloadUpdate = () => new Promise((resolve) => {
    resolveDownload = () => { f.updater.emit('update-downloaded', { version: '0.10.0' }); resolve(); };
  });
  const downloading = f.updates.download();
  await assert.rejects(f.updates.download(), /No desktop update/);
  assert.equal((await f.updates.check()).status, 'downloading');
  resolveDownload();
  await downloading;
  assert.equal((await f.updates.check()).status, 'downloaded');
});

test('actual updater semver comparison accepts newer releases but rejects equal/older/invalid', async () => {
  const updater = new NsisUpdater(null, { version: '0.9.19' });
  updater.allowDowngrade = false;
  updater.isUserWithinRollout = () => true;
  for (const version of ['0.9.20', '0.10.0', '1.0.0']) {
    assert.equal(await updater.isUpdateAvailable({ version }), true, version);
  }
  for (const version of ['0.9.19', '0.9.18', '0.8.99']) {
    assert.equal(await updater.isUpdateAvailable({ version }), false, version);
  }
  await assert.rejects(updater.isUpdateAvailable({ version: 'latest' }), { code: 'ERR_UPDATER_INVALID_VERSION' });
});

test('updater download digest validates SHA-512 and rejects tampered installer bytes', async () => {
  const bytes = Buffer.from('test installer content');
  const hash = crypto.createHash('sha512').update(bytes).digest('base64');
  const verify = (data) => pipeline(
    Readable.from([data]), new DigestTransform(hash),
    new Writable({ write: (_chunk, _encoding, callback) => callback() }),
  );
  await verify(bytes);
  await assert.rejects(verify(Buffer.from('tampered installer')), { code: 'ERR_CHECKSUM_MISMATCH' });
});

test('updater IPC rejects untrusted frames before any operation', () => {
  const handlers = new Map();
  const f = fixture();
  const trusted = {};
  registerUpdatesIpc({ handle: (channel, handler) => handlers.set(channel, handler) }, {
    updates: f.updates, isTrustedSender: (event) => event === trusted, log: () => {},
  });
  assert.equal(handlers.size, 4);
  for (const handler of handlers.values()) assert.throws(() => handler({}), /Untrusted update IPC/);
  assert.equal(handlers.get('updates:getState')(trusted).currentVersion, '0.9.19');
  assert.equal(f.calls.checks, 0);
});

test('publishing configuration provides stable NSIS updater metadata and preserves immutable versions', () => {
  const root = path.join(__dirname, '..');
  const config = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(config.build.publish.provider, 'github');
  assert.equal(config.build.publish.owner, 'sould666');
  assert.equal(config.build.publish.repo, 'tilldeals-clientapp');
  assert.equal(config.build.publish.releaseType, 'release');
  assert.equal(config.build.nsis.artifactName, 'TillDeals-Hardware-Setup-${version}-win-${arch}.${ext}');
  assert.ok(config.build.win.target.some((target) => target.target === 'nsis' && target.arch.includes('x64')));
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/windows-installer.yml'), 'utf8');
  assert.ok(workflow.includes('dist/latest.yml'));
  assert.ok(workflow.includes('.blockmap'));
  assert.ok(workflow.includes('gh release create "${{ steps.release.outputs.tag }}"'));
  assert.equal(workflow.includes('gh release delete'), false);
  assert.equal(workflow.includes('--prerelease \\' ), false);
  assert.ok(workflow.includes('--prerelease=false'));
  assert.equal(workflow.includes('workflow_dispatch'), false);
  assert.ok(workflow.includes('run-name: Windows release pipeline'));
  assert.ok(workflow.includes('node scripts/release-version.js'));
  assert.ok(workflow.includes('Verify published artifact and checksum'));
});

test('lockfile includes the optional Windows signing dependency graph required by npm ci', () => {
  const lock = JSON.parse(fs.readFileSync(path.join(__dirname, '../package-lock.json'), 'utf8'));
  for (const name of [
    '@electron/windows-sign', 'cross-dirname', 'postject',
    '@electron/windows-sign/node_modules/fs-extra',
    '@electron/windows-sign/node_modules/jsonfile',
    '@electron/windows-sign/node_modules/universalify',
    'postject/node_modules/commander',
  ]) {
    assert.ok(lock.packages[`node_modules/${name}`], `Missing Windows lockfile dependency: ${name}`);
  }
});
