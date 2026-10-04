const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function parseVersion(tag) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(tag);
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  return parts.every(Number.isSafeInteger) ? parts : null;
}

function compareVersions(a, b) {
  for (let index = 0; index < 3; index++) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

function changedSourceLines(numstat) {
  return numstat.split(/\r?\n/).filter(Boolean).reduce((total, line) => {
    const [added, deleted, filename] = line.split('\t');
    if (!filename?.startsWith('src/') || !/\.(?:js|css|html)$/.test(filename)) return total;
    if (!/^\d+$/.test(added) || !/^\d+$/.test(deleted)) throw new Error(`Non-text source diff: ${filename}`);
    return total + Number(added) + Number(deleted);
  }, 0);
}

function nextVersion(previous, changedLines) {
  if (!previous) return '1.0.0';
  const parts = parseVersion(previous);
  if (!parts) throw new Error('Invalid baseline release version.');
  if (!Number.isSafeInteger(changedLines) || changedLines < 0) throw new Error('Invalid changed-line count.');
  if (changedLines >= 2000) return `${parts[0] + 1}.0.0`;
  if (changedLines >= 500) return `${parts[0]}.${parts[1] + 1}.0`;
  return `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
}

async function prepareRelease({
  root = path.resolve(__dirname, '..'), repository = process.env.GITHUB_REPOSITORY,
  sha = process.env.GITHUB_SHA, token = process.env.GH_TOKEN,
  output = process.env.GITHUB_OUTPUT, fetchImpl = globalThis.fetch,
  git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim(),
}) {
  if (!repository || !sha || !token || !output) throw new Error('Missing CI release environment.');
  if (process.env.GITHUB_REF !== 'refs/heads/main') throw new Error('Releases are allowed only from main.');
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !/^[0-9a-f]{40}$/.test(sha)) throw new Error('Invalid repository/commit.');
  const releases = [];
  for (let page = 1; ; page++) {
    const response = await fetchImpl(`https://api.github.com/repos/${repository}/releases?per_page=100&page=${page}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`Release lookup failed: HTTP ${response.status}`);
    const batch = await response.json();
    if (!Array.isArray(batch)) throw new Error('Invalid releases response.');
    releases.push(...batch);
    if (batch.length < 100) break;
  }
  const stable = releases.filter((release) => !release.prerelease && !release.draft
    && parseVersion(release.tag_name)?.[0] >= 1)
    .sort((a, b) => compareVersions(parseVersion(b.tag_name), parseVersion(a.tag_name)));
  const baseline = stable[0];
  let version;
  let publish = true;
  let lines = 0;
  if (baseline) {
    const baselineSha = git(['rev-list', '-n', '1', `refs/tags/${baseline.tag_name}`]);
    if (baselineSha === sha) {
      version = parseVersion(baseline.tag_name).join('.');
      publish = false;
    } else {
      git(['merge-base', '--is-ancestor', baselineSha, sha]);
      lines = changedSourceLines(git(['diff', '--numstat', '--no-renames', baselineSha, sha, '--', 'src/']));
      version = nextVersion(baseline.tag_name, lines);
    }
  } else {
    version = '1.0.0';
  }
  const tag = `v${version}`;
  if (publish && releases.some((release) => release.tag_name === tag)) {
    throw new Error(`${tag} already exists as an unfinished/non-stable release; resolve it before retrying.`);
  }
  const packagePath = path.join(root, 'package.json');
  const lockPath = path.join(root, 'package-lock.json');
  const manifest = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  console.log(`Current source version: ${manifest.version}`);
  console.log(`Release version: ${version}; changed source lines: ${lines}; publish: ${publish}`);
  manifest.version = version;
  lock.version = version;
  lock.packages[''].version = version;
  fs.writeFileSync(packagePath, `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
  fs.appendFileSync(output, `version=${version}\ntag=${tag}\npublish=${publish}\nchangedLines=${lines}\n`);
  return { version, tag, publish, lines };
}

if (require.main === module) {
  prepareRelease({}).catch((error) => {
    console.error(`Release preparation failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { parseVersion, changedSourceLines, nextVersion, prepareRelease };
