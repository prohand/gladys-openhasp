// -----------------------------------------------------------------------------
// The changelog roll run by the Release workflow.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { rollChangelog } from '../.github/scripts/changelog-release.mjs';

const REPO = 'https://github.com/prohand/gladys-openhasp';

test('the first release moves Unreleased under its version and links the tag', () => {
  const text = `# Changelog\n\n## [Unreleased]\n\n### Added\n\n- Plates.\n\n[Unreleased]: ${REPO}/commits/main\n`;
  const rolled = rollChangelog(text, '1.0.0', '2026-11-22');
  assert.match(
    rolled,
    /## \[Unreleased\]\n\n## \[1\.0\.0\] - 2026-11-22\n\n### Added\n\n- Plates\./,
  );
  assert.match(rolled, new RegExp(`\\[Unreleased\\]: ${REPO}/compare/v1\\.0\\.0\\.\\.\\.HEAD`));
  assert.match(rolled, new RegExp(`\\[1\\.0\\.0\\]: ${REPO}/releases/tag/v1\\.0\\.0`));
});

test('a later release compares with the previous tag', () => {
  const text = `## [Unreleased]\n\n- Fix.\n\n## [1.0.0] - 2026-11-22\n\n- Plates.\n\n[Unreleased]: ${REPO}/compare/v1.0.0...HEAD\n[1.0.0]: ${REPO}/releases/tag/v1.0.0\n`;
  const rolled = rollChangelog(text, '1.0.1', '2026-12-01');
  assert.match(rolled, /## \[1\.0\.1\] - 2026-12-01\n\n- Fix\./);
  assert.match(
    rolled,
    new RegExp(`\\[1\\.0\\.1\\]: ${REPO}/compare/v1\\.0\\.0\\.\\.\\.v1\\.0\\.1`),
  );
});

test('an empty Unreleased still names the release', () => {
  const rolled = rollChangelog('## [Unreleased]\n', '1.0.2', '2026-12-02');
  assert.match(
    rolled,
    /## \[1\.0\.2\] - 2026-12-02\n\n- Maintenance release, no functional change\./,
  );
});

test('the changelog of the repository can be rolled', async () => {
  const text = await readFile(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  assert.match(text, /^## \[Unreleased\]$/m);
  assert.notEqual(rollChangelog(text, '9.9.9', '2026-12-31'), text);
});
