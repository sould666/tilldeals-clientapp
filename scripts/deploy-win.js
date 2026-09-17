const { existsSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const distDirectory = path.join(projectRoot, 'dist');
const packagePath = path.join(projectRoot, 'package.json');
const releaseType = process.argv.slice(2).find((argument) => ['major', 'minor', 'patch'].includes(argument)) || 'patch';
const dryRun = process.argv.includes('--dry-run');

function incrementVersion(version, type) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) throw new Error(`Unsupported package version: ${version}`);

  let [major, minor, patch] = match.slice(1).map(Number);
  if (type === 'major') {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (type === 'minor') {
    minor += 1;
    patch = 0;
  } else {
    patch += 1;
  }
  return `${major}.${minor}.${patch}`;
}

const originalPackage = readFileSync(packagePath, 'utf8');
const packageData = JSON.parse(originalPackage);
const nextVersion = incrementVersion(packageData.version, releaseType);

if (dryRun) {
  console.log(`Version ${packageData.version} -> ${nextVersion} (${releaseType})`);
  process.exit(0);
}

const updatedPackage = originalPackage.replace(
  new RegExp(`("version"\\s*:\\s*")${packageData.version.replaceAll('.', '\\.')}(")`),
  `$1${nextVersion}$2`,
);
writeFileSync(packagePath, updatedPackage);
console.log(`Version ${packageData.version} -> ${nextVersion} (${releaseType})`);

if (existsSync(distDirectory)) {
  rmSync(distDirectory, { recursive: true, force: true });
}

const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const result = spawnSync(command, ['electron-builder', '--win', 'zip', '--x64'], {
  cwd: projectRoot,
  stdio: 'inherit',
});

if (result.error) {
  writeFileSync(packagePath, originalPackage);
  console.error(`Could not start Electron Builder: ${result.error.message}`);
  process.exit(1);
}

if (result.status !== 0) writeFileSync(packagePath, originalPackage);
process.exit(result.status ?? 1);
