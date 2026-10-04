const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { changedSourceLines, nextVersion, prepareRelease } = require('./release-version');

test('automatic release starts stable at 1.0.0 and enforces exact bump thresholds', () => {
  assert.equal(nextVersion(null, 10000), '1.0.0');
  for (const [lines, expected] of [
    [0, '1.2.4'], [499, '1.2.4'], [500, '1.3.0'], [1999, '1.3.0'], [2000, '2.0.0'],
  ]) assert.equal(nextVersion('v1.2.3', lines), expected);
  assert.throws(() => nextVersion('latest', 1), /Invalid baseline/);
  assert.throws(() => nextVersion('1.0.0', -1), /Invalid changed/);
});

test('source quantity excludes docs/tests/dependencies/assets and sums additions/deletions', () => {
  assert.equal(changedSourceLines([
    '200\t300\tsrc/main.js',
    '10\t20\tsrc/renderer/styles.css',
    '5\t10\tsrc/renderer/index.html',
    '2000\t2000\tpackage-lock.json',
    '1000\t0\tscripts/updates.test.js',
    '99\t0\tREADME.md',
    '-\t-\tsrc/renderer/logo.svg',
  ].join('\n')), 545);
  assert.throws(() => changedSourceLines('-\t-\tsrc/main.js'), /Non-text/);
});

function fixture(t, releases, { diff = '500\t0\tsrc/main.js', baselineSha = 'b'.repeat(40) } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tilldeals-release-test-'));
  t.after(() => {
    for (const name of ['package.json', 'package-lock.json', 'output']) fs.unlinkSync(path.join(root, name));
    fs.rmdirSync(root);
  });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '1.0.0', name: 'test' }));
  fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({ version: '1.0.0', packages: { '': { version: '1.0.0' } } }));
  fs.writeFileSync(path.join(root, 'output'), '');
  const oldRef = process.env.GITHUB_REF;
  process.env.GITHUB_REF = 'refs/heads/main';
  t.after(() => {
    if (oldRef === undefined) delete process.env.GITHUB_REF;
    else process.env.GITHUB_REF = oldRef;
  });
  const gitCalls = [];
  return {
    root, gitCalls,
    options: {
      root, repository: 'sould666/tilldeals-clientapp', sha: 'a'.repeat(40),
      token: 'fixture-not-a-real-token', output: path.join(root, 'output'),
      fetchImpl: async () => Response.json(releases),
      git: (args) => {
        gitCalls.push(args);
        if (args[0] === 'rev-list') return baselineSha;
        if (args[0] === 'diff') return diff;
        if (args[0] === 'merge-base') return '';
        throw new Error('Unexpected git command');
      },
    },
  };
}

test('old 0.x and prereleases do not prevent first stable 1.0.0, both manifests are stamped', async (t) => {
  const f = fixture(t, [
    { tag_name: 'v0.9.19', draft: false, prerelease: false },
    { tag_name: 'latest', draft: false, prerelease: true },
  ]);
  const result = await prepareRelease(f.options);
  assert.equal(result.version, '1.0.0');
  assert.equal(result.publish, true);
  assert.equal(f.gitCalls.length, 0);
  const lock = JSON.parse(fs.readFileSync(path.join(f.root, 'package-lock.json')));
  assert.equal(lock.version, '1.0.0');
  assert.equal(lock.packages[''].version, '1.0.0');
});

test('latest stable semver baseline selects minor and stamps identical packaged/lock versions', async (t) => {
  const f = fixture(t, [
    { tag_name: 'v1.0.9', draft: false, prerelease: false },
    { tag_name: 'v1.2.3', draft: false, prerelease: false },
    { tag_name: 'v99.0.0', draft: false, prerelease: true },
  ]);
  const result = await prepareRelease(f.options);
  assert.equal(result.version, '1.3.0');
  assert.equal(result.lines, 500);
  assert.equal(f.gitCalls[0][3], 'refs/tags/v1.2.3');
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.root, 'package.json'))).version, '1.3.0');
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.root, 'package-lock.json'))).packages[''].version, '1.3.0');
  assert.match(fs.readFileSync(path.join(f.root, 'output'), 'utf8'), /publish=true/);
});

test('rerun of latest published commit does not bump or rebuild', async (t) => {
  const f = fixture(t, [{ tag_name: 'v1.2.3', draft: false, prerelease: false }], { baselineSha: 'a'.repeat(40) });
  const result = await prepareRelease(f.options);
  assert.equal(result.version, '1.2.3');
  assert.equal(result.publish, false);
  assert.equal(f.gitCalls.length, 1);
});

test('release conflicts, lookup failure, non-main refs and divergent history fail explicitly', async (t) => {
  const f = fixture(t, [{ tag_name: 'v1.0.0', draft: true, prerelease: false }]);
  await assert.rejects(prepareRelease(f.options), /unfinished/);
  await assert.rejects(prepareRelease({ ...f.options, fetchImpl: async () => new Response(null, { status: 503 }) }), /HTTP 503/);
  process.env.GITHUB_REF = 'refs/heads/feature';
  await assert.rejects(prepareRelease(f.options), /only from main/);
  process.env.GITHUB_REF = 'refs/heads/main';
  await assert.rejects(prepareRelease({
    ...f.options,
    fetchImpl: async () => Response.json([{ tag_name: 'v1.0.0', draft: false, prerelease: false }]),
    git: (args) => {
      if (args[0] === 'rev-list') return 'b'.repeat(40);
      throw new Error('Divergent history');
    },
  }), /Divergent history/);
});
