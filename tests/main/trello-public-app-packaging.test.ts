import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('Trello public app packaging', () => {
  it('uses a build variable and refuses to reuse its output without the variable', () => {
    const root = mkdtempSync(join(tmpdir(), 'branchloom-trello-package-'));
    roots.push(root);
    const script = resolve('scripts/prepare-trello-public-app.mjs');
    const key = 'c'.repeat(32);
    const environment = { ...process.env, BRANCHLOOM_TRELLO_PUBLIC_KEY: key };
    execFileSync(process.execPath, [script], { cwd: root, env: environment });
    expect(JSON.parse(readFileSync(join(root, 'trello-public-app.json'), 'utf8'))).toEqual({ key });
    expect(() => execFileSync(process.execPath, [script], {
      cwd: root, env: { ...environment, BRANCHLOOM_TRELLO_PUBLIC_KEY: '' }, stdio: 'pipe',
    })).toThrow();
  });
});
