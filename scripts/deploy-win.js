const { existsSync, rmSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const distDirectory = path.join(projectRoot, 'dist');

if (existsSync(distDirectory)) {
  rmSync(distDirectory, { recursive: true, force: true });
}

const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const result = spawnSync(command, ['electron-builder', '--win', 'zip', '--x64'], {
  cwd: projectRoot,
  stdio: 'inherit',
});

if (result.error) {
  console.error(`Could not start Electron Builder: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
