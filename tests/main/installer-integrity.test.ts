import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const roots: string[] = [];
const script = join(process.cwd(), 'scripts', 'check-installer.mjs');

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-installer-integrity-'));
  roots.push(root);
  const installer = join(root, 'out', 'installer');
  const app = join(installer, 'win-unpacked', 'resources', 'app');
  mkdirSync(join(app, 'docs'), { recursive: true });
  writeFileSync(join(app, 'LICENSE'), 'synthetic license fixture');
  writeFileSync(join(app, 'docs', 'COMMERCIAL_LICENSING.md'), 'synthetic notice fixture');
  writeFileSync(join(installer, 'win-unpacked', 'resources', 'app-update.yml'), 'provider: github\n');
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '0.1.1' }));
  const name = 'Branchloom-Setup-0.1.1.exe';
  const setup = join(installer, name);
  const bytes = Buffer.from('synthetic installer contents');
  const hash = createHash('sha512').update(bytes).digest('base64');
  writeFileSync(setup, bytes);
  writeFileSync(join(installer, 'latest.yml'), [
    'version: 0.1.1',
    'files:',
    `  - url: ${name}`,
    `    sha512: ${hash}`,
    `    size: ${bytes.length}`,
    `path: ${name}`,
    `sha512: ${hash}`,
    '',
  ].join('\n'));
  return { root, setup, installer };
}

function check(root: string) {
  return spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 10_000 });
}

describe('Windows installer release integrity gate', () => {
  it('accepts a matching release manifest and rejects a damaged installer', () => {
    const { root, setup } = fixture();
    expect(check(root)).toMatchObject({ status: 0 });
    writeFileSync(setup, 'synthetic installer contentx');
    const damaged = check(root);
    expect(damaged.status).not.toBe(0);
    expect(damaged.stderr).toContain('checksum does not match');
  });

  it('rejects missing update metadata and a mismatched package version', () => {
    const { root, installer } = fixture();
    rmSync(join(installer, 'win-unpacked', 'resources', 'app-update.yml'));
    expect(check(root).stderr).toContain('update feed is missing');
    writeFileSync(join(installer, 'win-unpacked', 'resources', 'app-update.yml'), 'provider: github\n');
    writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '0.1.2' }));
    expect(check(root).stderr).toContain('version does not match');
  });
});
