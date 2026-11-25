const { spawn } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve, sep } = require('node:path');
const electron = require('electron');

const root = mkdtempSync(join(tmpdir(), 'branchloom-team-review-smoke-'));
if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unexpected smoke profile path.');
const child = spawn(electron, ['scripts/smoke-team-review.cjs', ...process.argv.slice(2)], {
  cwd: process.cwd(), windowsHide: true, stdio: 'inherit',
  env: { ...process.env, BRANCHLOOM_TEAM_REVIEW_SMOKE_ROOT: root },
});
const result = new Promise((resolveResult, rejectResult) => {
  child.once('error', rejectResult);
  child.once('exit', (code) => resolveResult(code));
});

result.then(async (code) => {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try { rmSync(root, { recursive: true, force: true }); break; }
    catch (error) {
      if (attempt === 29) process.stderr.write(`Smoke profile cleanup was delayed: ${error.message}\n`);
      else await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
    }
  }
  process.exitCode = code ?? 1;
}, (error) => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });
