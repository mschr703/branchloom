// Optional local transport check. It runs only when invoked explicitly and uses synthetic data.
import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Y = require('yjs');
const { StudioStore } = require('../dist-main/main/store.js');
const { TeamConnectionStore } = require('../dist-main/main/team-connection-store.js');
const { TeamJoinAttemptStore } = require('../dist-main/main/team-join-attempt.js');
const { TeamLocalService } = require('../dist-main/main/team-local-service.js');
const { TeamRemoteClient } = require('../dist-main/main/team-remote-client.js');

function secureStorage() {
  const key = randomBytes(32);
  return {
    isAsyncEncryptionAvailable: async () => true,
    encryptStringAsync: async (text) => {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
    },
    decryptStringAsync: async (sealed) => {
      const decipher = createDecipheriv('aes-256-gcm', key, sealed.subarray(0, 12));
      decipher.setAuthTag(sealed.subarray(12, 28));
      return { result: Buffer.concat([decipher.update(sealed.subarray(28)), decipher.final()]).toString('utf8'),
        shouldReEncrypt: false };
    },
  };
}

const root = mkdtempSync(join(tmpdir(), 'branchloom-team-tailnet-smoke-'));
if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unexpected smoke directory.');
const ownerRoot = join(root, 'owner');
const guestRoot = join(root, 'guest');
mkdirSync(ownerRoot); mkdirSync(guestRoot);
const store = new StudioStore(join(ownerRoot, 'studio.sqlite'));
const host = new TeamLocalService(store, new TeamConnectionStore(ownerRoot, secureStorage()));
let step = 'setup';

try {
  const project = store.createProject({ name: 'Synthetic tailnet project', path: ownerRoot });
  const card = store.createCard({ projectId: project.id, columnId: store.snapshot(project.id).columns[0].id,
    title: 'Synthetic collaboration task', description: 'Accepted synthetic description' });
  const workspace = await host.create({ projectId: project.id, workspaceName: 'Synthetic team', ownerName: 'Owner' });
  step = 'tailnet bind';
  const status = await host.enableTailnet(project.id);
  assert.equal(status.enabled, true);
  assert.match(status.coordinatorUrl, /^http:\/\/100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+:\d+$/);
  step = 'invitation and join';
  const invite = await host.invite(project.id, 'editor', 'tailnet');
  assert.equal(invite.coordinatorUrl, status.coordinatorUrl);
  const guest = new TeamRemoteClient(new TeamConnectionStore(guestRoot, secureStorage()),
    new TeamJoinAttemptStore(guestRoot, secureStorage()));
  const joined = await guest.beginJoin({ coordinatorUrl: invite.coordinatorUrl,
    inviteSecret: invite.inviteSecret, displayName: 'Synthetic guest' });
  step = 'authorized reads';
  const board = await guest.board({ workspaceId: workspace.workspaceId, projectId: project.id });
  assert.ok(board.cards.some((item) => item.id === card.id && item.title === card.title));
  const initial = await guest.cardDraft({ workspaceId: workspace.workspaceId, projectId: project.id, cardId: card.id });
  assert.equal(initial.revision, 0);
  step = 'shared draft update';
  const document = new Y.Doc();
  document.getText('body').insert(0, 'Synthetic team note');
  await guest.updateCardDraft({ workspaceId: workspace.workspaceId, projectId: project.id,
    cardId: card.id, mutationId: randomUUID(), update: Buffer.from(Y.encodeStateAsUpdate(document)).toString('base64') });
  const saved = await guest.cardDraft({ workspaceId: workspace.workspaceId, projectId: project.id, cardId: card.id });
  assert.equal(saved.revision, 1);
  const readBack = new Y.Doc();
  Y.applyUpdate(readBack, Buffer.from(saved.update, 'base64'));
  assert.equal(readBack.getText('body').toString(), 'Synthetic team note');
  document.destroy(); readBack.destroy();
  step = 'revocation';
  await host.revoke(project.id, joined.memberId);
  await assert.rejects(guest.board({ workspaceId: workspace.workspaceId, projectId: project.id }));
  await assert.rejects(guest.cardDraft({ workspaceId: workspace.workspaceId, projectId: project.id, cardId: card.id }));
  process.stdout.write('Team tailnet smoke passed: join, board, shared draft, revocation.\n');
} catch {
  process.stderr.write(`Team tailnet smoke failed at ${step}.\n`);
  process.exitCode = 1;
} finally {
  try { await host.close(); }
  finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
}
