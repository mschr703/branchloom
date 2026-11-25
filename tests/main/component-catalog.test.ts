import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanProjectComponents } from '../../src/main/component-catalog';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-components-'));
  roots.push(root);
  const result = spawnSync('git', ['init', '-q'], { cwd: root, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(String(result.stderr || result.error));
  mkdirSync(join(root, 'src'));
  return root;
}

function add(root: string, file: string, content: string) {
  writeFileSync(join(root, file), content);
  const result = spawnSync('git', ['add', '--', file], { cwd: root, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(String(result.stderr || result.error));
}

describe('bounded component source inventory', () => {
  it('lists versioned TSX/JSX export candidates with source paths and lines without executing them', async () => {
    const root = fixture();
    add(root, 'src/Button.tsx', 'const sideEffect = () => { throw new Error("must not execute"); };\nexport function Button() { return <button>OK</button>; }\nexport const Card = () => <article>Card</article>;\nexport function calculate() { return <p>lowercase</p>; }');
    add(root, 'src/Utility.tsx', 'export function Utility() { return 42; }');
    add(root, 'src/Badge.jsx', 'export const Badge = () => <span>badge</span>;');
    writeFileSync(join(root, 'src', 'Untracked.tsx'), 'export function Untracked() { return <p />; }');
    const result = await scanProjectComponents(root);
    expect(result).toMatchObject({ source: 'git-index', scannedFiles: 3, partial: false });
    expect(result.candidates).toEqual([
      { name: 'Badge', path: 'src/Badge.jsx', line: 1, kind: 'const', sourceFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/) },
      { name: 'Button', path: 'src/Button.tsx', line: 2, kind: 'function', sourceFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/) },
      { name: 'Card', path: 'src/Button.tsx', line: 3, kind: 'const', sourceFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/) },
    ]);
  });

  it('marks missing tracked files partial and rejects a project subdirectory', async () => {
    const root = fixture();
    add(root, 'src/Missing.tsx', 'export const Missing = () => <div />;');
    unlinkSync(join(root, 'src', 'Missing.tsx'));
    const result = await scanProjectComponents(root);
    expect(result).toMatchObject({ scannedFiles: 0, candidates: [], partial: true });
    expect(result.notes.join(' ')).toContain('fehlten');
    await expect(scanProjectComponents(join(root, 'src'))).rejects.toThrow('Git-Wurzelordner');
  });

  it('skips an oversized tracked source while keeping valid candidates', async () => {
    const root = fixture();
    add(root, 'src/Huge.tsx', 'export function Huge() { return <div />; }\n' + 'x'.repeat(128 * 1024));
    add(root, 'src/Small.tsx', 'export function Small() { return <span />; }');
    const result = await scanProjectComponents(root);
    expect(result).toMatchObject({ scannedFiles: 1, partial: true, candidates: [{ name: 'Small', path: 'src/Small.tsx', line: 1, kind: 'function' }] });
    expect(result.notes.join(' ')).toContain('zu groß');
  });

  it('honors cancellation before and during the asynchronous Git preflight', async () => {
    const root = fixture();
    const before = new AbortController();
    before.abort();
    await expect(scanProjectComponents(root, before.signal)).rejects.toThrow('abgebrochen');
    const during = new AbortController();
    const pending = scanProjectComponents(root, during.signal);
    during.abort();
    await expect(pending).rejects.toThrow('abgebrochen');
  });
});
