const { spawn } = require('node:child_process');
const { randomBytes, randomUUID } = require('node:crypto');
const { existsSync, mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve, sep } = require('node:path');
const electron = require('electron');

if (typeof electron === 'string') {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-team-migration-'));
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unexpected smoke profile path.');
  const child = spawn(electron, [__filename], {
    cwd: process.cwd(), windowsHide: true, stdio: 'inherit',
    env: { ...process.env, BRANCHLOOM_TEAM_MIGRATION_ROOT: root },
  });
  child.once('error', (error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
  child.once('exit', async (code) => {
    process.exitCode = code ?? 1;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try { rmSync(root, { recursive: true, force: true }); break; }
      catch (error) { if (attempt === 19) process.stderr.write(`Synthetic profile cleanup delayed: ${error.message}\n`);
        else await new Promise((resolveDelay) => setTimeout(resolveDelay, 200)); }
    }
  });
} else {
  const { app, safeStorage } = electron;
  const root = process.env.BRANCHLOOM_TEAM_MIGRATION_ROOT;
  if (!root || !resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error('An isolated team profile is required.');
  app.setPath('userData', root);
  app.whenReady().then(async () => {
    const { TeamConnectionStore } = require('../dist-main/main/team-connection-store');
    const { TeamSecretStorage } = require('../dist-main/main/team-secret-storage');
    const input = { workspaceId: randomUUID(), memberId: randomUUID(), displayName: 'Synthetic member',
      role: 'editor', coordinatorUrl: 'http://127.0.0.1:4567', credential: randomBytes(32).toString('base64url') };
    const oldStore = new TeamConnectionStore(root, safeStorage);
    await oldStore.save(input);
    const file = join(root, 'team-connections.bin');
    const oldBytes = readFileSync(file);
    if (oldBytes.subarray(0, 12).toString('ascii') === 'BLTEAMDATA1\0') throw new Error('Old format was not raw Electron safeStorage.');
    const newStore = new TeamConnectionStore(root,
      new TeamSecretStorage(root, safeStorage, 'team-connections'));
    const migrated = await newStore.get(input.workspaceId);
    if (!migrated || Object.keys(input).some((key) => migrated[key] !== input[key])) {
      throw new Error('Legacy team credential changed during migration.');
    }
    const newBytes = readFileSync(file);
    if (newBytes.subarray(0, 12).toString('ascii') !== 'BLTEAMDATA1\0' ||
      newBytes.includes(Buffer.from(input.credential)) || !existsSync(join(root, 'team-secret-key.bin'))) {
      throw new Error('Legacy team credential was not durably re-encrypted.');
    }
    const reopened = new TeamConnectionStore(root,
      new TeamSecretStorage(root, safeStorage, 'team-connections'));
    if ((await reopened.get(input.workspaceId))?.credential !== input.credential) throw new Error('Migrated credential cannot be read.');
    process.stdout.write('TEAM_SECRET_MIGRATION_SMOKE_OK\n');
    app.quit();
  }).catch((error) => { process.stderr.write(`TEAM_SECRET_MIGRATION_SMOKE_FAILED: ${error.stack || error}\n`); app.exit(1); });
}
