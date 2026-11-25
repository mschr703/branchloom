import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { StudioStore } from '../../src/main/store';
import { assignDevAccount, cardDevAccountGrant, createDevAccount, devAccountForProject, devAccountOverview } from '../../src/main/dev-account';

const roots: string[] = [];
const stores: StudioStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) if (store.db.open) store.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-dev-account-')); roots.push(root);
  const dbPath = join(root, 'studio.sqlite');
  const store = new StudioStore(dbPath); stores.push(store);
  const projectRoot = join(root, 'shop'); const otherRoot = join(root, 'other');
  mkdirSync(projectRoot); mkdirSync(otherRoot);
  const project = store.createProject({ name: 'Synthetic shop', path: projectRoot });
  const otherProject = store.createProject({ name: 'Unrelated', path: otherRoot });
  const columnId = store.snapshot(project.id).columns[0]!.id;
  const first = store.createCard({ projectId: project.id, columnId, title: 'Admin variant' });
  const second = store.createCard({ projectId: project.id, columnId, title: 'User variant' });
  return { root, dbPath, store, project, otherProject, first, second };
}

describe('local development accounts', () => {
  it('keeps two exact card grants after restart and never places secrets in cards', () => {
    const f = fixture();
    const admin = createDevAccount(f.store, { projectId: f.project.id, service: 'Shop', environment: 'local', role: 'admin', subject: 'admin-fixture', probePath: '/api/me' });
    const user = createDevAccount(f.store, { projectId: f.project.id, service: 'Shop', environment: 'local', role: 'user', subject: 'user-fixture', probePath: '/api/me' });
    const firstRevision = devAccountOverview(f.store, { projectId: f.project.id, cardId: f.first.id }).cardRevision;
    const secondRevision = devAccountOverview(f.store, { projectId: f.project.id, cardId: f.second.id }).cardRevision;
    assignDevAccount(f.store, { projectId: f.project.id, cardId: f.first.id, accountId: admin.id, expectedCardRevision: firstRevision });
    assignDevAccount(f.store, { projectId: f.project.id, cardId: f.second.id, accountId: user.id, expectedCardRevision: secondRevision });
    expect(cardDevAccountGrant(f.store, f.first.id).id).toBe(admin.id);
    expect(cardDevAccountGrant(f.store, f.second.id).id).toBe(user.id);
    expect(JSON.stringify(f.store.card(f.first.id))).not.toContain('admin-fixture');
    expect(JSON.stringify(f.store.exportProjectPackage(f.project.id))).not.toContain('admin-fixture');
    f.store.close(); stores.splice(stores.indexOf(f.store), 1);
    const reopened = new StudioStore(f.dbPath); stores.push(reopened);
    expect(cardDevAccountGrant(reopened, f.first.id).id).toBe(admin.id);
    expect(cardDevAccountGrant(reopened, f.second.id).id).toBe(user.id);
    expect(devAccountOverview(reopened, { projectId: f.project.id, cardId: f.first.id }).accounts).toHaveLength(2);
  });

  it('rejects wrong-project and stale assignments; a revoked card cannot use an account', () => {
    const f = fixture();
    const account = createDevAccount(f.store, { projectId: f.project.id, service: 'Shop', environment: 'local', role: 'admin', subject: 'admin-fixture', probePath: '/api/me' });
    const revision = devAccountOverview(f.store, { projectId: f.project.id, cardId: f.first.id }).cardRevision;
    expect(() => devAccountForProject(f.store, f.otherProject.id, account.id)).toThrow('does not belong');
    expect(() => devAccountOverview(f.store, { projectId: f.otherProject.id, cardId: f.first.id })).toThrow('another project');
    expect(() => assignDevAccount(f.store, { projectId: f.otherProject.id, cardId: f.first.id, accountId: account.id, expectedCardRevision: revision })).toThrow('unavailable');
    const saved = assignDevAccount(f.store, { projectId: f.project.id, cardId: f.first.id, accountId: account.id, expectedCardRevision: revision });
    expect(() => assignDevAccount(f.store, { projectId: f.project.id, cardId: f.first.id, accountId: null, expectedCardRevision: revision })).toThrow('changed');
    assignDevAccount(f.store, { projectId: f.project.id, cardId: f.first.id, accountId: null, expectedCardRevision: saved.cardRevision });
    expect(() => cardDevAccountGrant(f.store, f.first.id)).toThrow('No development account');
  });

  it('accepts only narrow identity endpoints and bounded account metadata', () => {
    const f = fixture();
    const valid = { projectId: f.project.id, service: 'Shop', environment: 'local', role: 'admin', subject: 'admin-fixture', probePath: '/api/me' };
    expect(() => createDevAccount(f.store, { ...valid, probePath: 'https://elsewhere.example/api/me' })).toThrow('local path');
    expect(() => createDevAccount(f.store, { ...valid, probePath: '//elsewhere.example/api/me' })).toThrow('local path');
    expect(() => createDevAccount(f.store, { ...valid, probePath: '/api/../me' })).toThrow('local path');
    expect(() => createDevAccount(f.store, { ...valid, service: 'Shop\nsecret' })).toThrow('one line');
  });
});
