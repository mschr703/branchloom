import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StudioStore } from '../../src/main/store';
import { readProjectMemorySource, refreshProjectMemoryIndex, searchProjectMemoryIndex } from '../../src/main/project-memory-index';

const roots: string[] = [];
const stores: StudioStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) { try { store.close(); } catch { /* Already closed by the test. */ } }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

function fixture(gitRepo = true) {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-memory-index-'));
  roots.push(root);
  const projectPath = join(root, 'project');
  mkdirSync(projectPath);
  if (gitRepo) {
    git(projectPath, 'init');
    mkdirSync(join(projectPath, 'src'));
    mkdirSync(join(projectPath, 'tests'));
    writeFileSync(join(projectPath, 'src', 'relay.ts'), "export const relayMarker = 'signal alpha';\n");
    writeFileSync(join(projectPath, 'tests', 'private-fixture.ts'), "export const excludedFixture = 'never indexed';\n");
    commit(projectPath, 'Initial relay implementation');
  }
  const file = join(root, 'studio.sqlite');
  const store = new StudioStore(file);
  stores.push(store);
  const project = store.createProject({ name: 'Synthetic', path: projectPath });
  const card = store.createCard({ projectId: project.id, columnId: store.snapshot(project.id).columns[0]!.id, title: 'Review relay' });
  store.updateCard({ id: card.id, description: 'Check signal alpha', labels: ['backend'], priority: 'high' });
  const session = store.createSession({ cardId: card.id, agentId: store.agents()[0]!.id });
  store.appendOutput(session.id, '\x1b[32mAgent checked the handshake marker\x1b[0m');
  store.finishSession(session.id, 'exited', 0);
  return { root, projectPath, file, store, project, card, session };
}

function git(path: string, ...args: string[]) {
  return execFileSync('git', ['-c', 'core.fsmonitor=false', ...args], { cwd: path, encoding: 'utf8', windowsHide: true });
}

function commit(path: string, message: string) {
  git(path, 'add', '.');
  git(path, '-c', 'user.name=Synthetic', '-c', 'user.email=synthetic@example.invalid', 'commit', '-m', message);
}

describe('automatic project memory index', () => {
  it('indexes task, finished conversation, commit and tracked code with provenance and survives restart', async () => {
    const { file, store, project, card, session } = fixture();
    const status = await refreshProjectMemoryIndex(store, project.id);
    expect(status.state).toBe('ready');
    expect(status.counts).toMatchObject({ task: 1, conversation: 1, commit: 1 });
    expect(status.counts.code).toBeGreaterThan(0);
    expect(status.codeFilesSeen).toBe(1);
    const relay = searchProjectMemoryIndex(store, { projectId: project.id, query: 'relay' });
    expect(relay.hits.some((hit) => hit.kind === 'task' && hit.cardId === card.id)).toBe(true);
    expect(relay.hits.some((hit) => hit.kind === 'commit' && hit.gitRef === status.gitRef)).toBe(true);
    expect(relay.hits.some((hit) => hit.kind === 'code' && hit.path === 'src/relay.ts')).toBe(true);
    const codeHit = relay.hits.find((hit) => hit.kind === 'code')!;
    expect(readProjectMemorySource(store, { projectId: project.id, kind: 'code', sourceId: codeHit.sourceId })).toMatchObject({ body: expect.stringContaining('relayMarker'), gitRef: status.gitRef, path: 'src/relay.ts' });
    expect(searchProjectMemoryIndex(store, { projectId: project.id, query: 'handshake', kind: 'conversation' }).hits[0]?.sessionId).toBe(session.id);
    expect(searchProjectMemoryIndex(store, { projectId: project.id, query: 'excludedFixture' }).hits).toEqual([]);
    store.close();
    const reopened = new StudioStore(file);
    stores.push(reopened);
    expect(searchProjectMemoryIndex(reopened, { projectId: project.id, query: 'relay' }).hits.some((hit) => hit.kind === 'code')).toBe(true);
    expect((await refreshProjectMemoryIndex(reopened, project.id)).gitRef).toBe(status.gitRef);
    reopened.close();
  });

  it('updates changed sources, drops removed tasks and rejects cross-project queries', async () => {
    const { root, projectPath, store, project, card } = fixture();
    await refreshProjectMemoryIndex(store, project.id);
    store.updateCard({ id: card.id, title: 'Review transport bridge', description: 'Updated card content' });
    await refreshProjectMemoryIndex(store, project.id);
    expect(searchProjectMemoryIndex(store, { projectId: project.id, query: 'transport', kind: 'task' }).hits[0]?.cardId).toBe(card.id);
    writeFileSync(join(projectPath, 'src', 'relay.ts'), "export const freshSignal = 'signal beta';\n");
    commit(projectPath, 'Replace relay with fresh signal');
    const updated = await refreshProjectMemoryIndex(store, project.id);
    expect(updated.gitRef).not.toBeNull();
    expect(searchProjectMemoryIndex(store, { projectId: project.id, query: 'relayMarker', kind: 'code' }).hits).toEqual([]);
    expect(searchProjectMemoryIndex(store, { projectId: project.id, query: 'freshSignal', kind: 'code' }).hits).toHaveLength(1);
    store.db.prepare('DELETE FROM cards WHERE id = ?').run(card.id);
    await refreshProjectMemoryIndex(store, project.id);
    expect(searchProjectMemoryIndex(store, { projectId: project.id, query: 'transport', kind: 'task' }).hits).toEqual([]);
    const otherPath = join(root, 'other');
    mkdirSync(otherPath);
    const other = store.createProject({ name: 'Other', path: otherPath });
    expect(searchProjectMemoryIndex(store, { projectId: other.id, query: 'freshSignal' }).hits).toEqual([]);
    expect(readProjectMemorySource(store, { projectId: other.id, kind: 'code', sourceId: 'src/relay.ts#1' })).toBeNull();
    expect(() => searchProjectMemoryIndex(store, { projectId: 'invalid', query: 'signal' })).toThrow();
    store.close();
  });

  it('keeps task and conversation recall when Git is unavailable and validates search input', async () => {
    const { store, project, session } = fixture(false);
    const status = await refreshProjectMemoryIndex(store, project.id);
    expect(status.state).toBe('git-unavailable');
    expect(status.counts).toMatchObject({ task: 1, conversation: 1, commit: 0, code: 0 });
    expect(searchProjectMemoryIndex(store, { projectId: project.id, query: 'handshake' }).hits[0]?.sessionId).toBe(session.id);
    expect(store.db.prepare('SELECT COUNT(*) AS count FROM sessions').get()).toMatchObject({ count: 1 });
    expect(() => searchProjectMemoryIndex(store, { projectId: project.id, query: 'x'.repeat(161) })).toThrow('160 Zeichen');
    expect(() => searchProjectMemoryIndex(store, { projectId: project.id, query: 'signal', kind: 'invalid' as 'task' })).toThrow('Ungültige Quelle');
    store.close();
  });

  it('limits a project inside a monorepo to its own commits and code', async () => {
    const { projectPath, store } = fixture();
    const childPath = join(projectPath, 'child');
    mkdirSync(childPath);
    writeFileSync(join(childPath, 'child.ts'), "export const childOnly = 'child topic';\n");
    commit(projectPath, 'Implement child topic');
    writeFileSync(join(projectPath, 'src', 'relay.ts'), "export const siblingOnly = 'sibling topic';\n");
    commit(projectPath, 'Implement sibling topic');
    const child = store.createProject({ name: 'Child', path: childPath });
    const status = await refreshProjectMemoryIndex(store, child.id);
    expect(status.counts.commit).toBe(1);
    expect(status.codeFilesSeen).toBe(1);
    expect(searchProjectMemoryIndex(store, { projectId: child.id, query: 'childOnly', kind: 'code' }).hits).toHaveLength(1);
    expect(searchProjectMemoryIndex(store, { projectId: child.id, query: 'siblingOnly' }).hits).toEqual([]);
    expect(searchProjectMemoryIndex(store, { projectId: child.id, query: 'sibling topic', kind: 'commit' }).hits).toEqual([]);
    store.close();
  });

  it('prefers local main commits ahead of an unchanged remote tracking ref', async () => {
    const { projectPath, store, project } = fixture();
    git(projectPath, 'branch', '-M', 'main');
    const remoteCommit = git(projectPath, 'rev-parse', 'HEAD').trim();
    git(projectPath, 'update-ref', 'refs/remotes/origin/main', remoteCommit);
    expect((await refreshProjectMemoryIndex(store, project.id)).gitRef).toBe(remoteCommit);
    writeFileSync(join(projectPath, 'src', 'relay.ts'), "export const localAhead = 'new local source';\n");
    commit(projectPath, 'Add local-ahead source');
    const localCommit = git(projectPath, 'rev-parse', 'HEAD').trim();
    expect(git(projectPath, 'rev-parse', 'refs/remotes/origin/main').trim()).toBe(remoteCommit);
    const updated = await refreshProjectMemoryIndex(store, project.id);
    expect(updated.gitRef).toBe(localCommit);
    expect(searchProjectMemoryIndex(store, { projectId: project.id, query: 'localAhead', kind: 'code' }).hits).toHaveLength(1);
    store.close();
  });

  it('retries a partial scan and allows an explicit rescan of an unchanged ready ref', async () => {
    const { projectPath, store, project } = fixture();
    writeFileSync(join(projectPath, 'src', 'relay.ts'), Array.from({ length: 450 }, (_, line) => `export const row${line} = 'bounded source';`).join('\n'));
    commit(projectPath, 'Add long bounded source');
    const partial = await refreshProjectMemoryIndex(store, project.id);
    expect(partial.state).toBe('partial');
    expect(partial.counts.code).toBe(4);
    store.db.prepare("DELETE FROM project_memory_sources WHERE project_id = ? AND kind = 'code' AND source_id = ?").run(project.id, 'src/relay.ts#1');
    expect((await refreshProjectMemoryIndex(store, project.id)).counts.code).toBe(4);

    writeFileSync(join(projectPath, 'src', 'relay.ts'), "export const stableSource = 'ready source';\n");
    commit(projectPath, 'Shorten bounded source');
    const ready = await refreshProjectMemoryIndex(store, project.id);
    expect(ready.state).toBe('ready');
    store.db.prepare("DELETE FROM project_memory_sources WHERE project_id = ? AND kind = 'code'").run(project.id);
    expect((await refreshProjectMemoryIndex(store, project.id)).counts.code).toBe(0);
    const restored = await refreshProjectMemoryIndex(store, project.id, true);
    expect(restored.gitRef).toBe(ready.gitRef);
    expect(restored.counts.code).toBe(1);
    expect(searchProjectMemoryIndex(store, { projectId: project.id, query: 'stableSource', kind: 'code' }).hits).toHaveLength(1);
    const automatic = refreshProjectMemoryIndex(store, project.id);
    const removeAfterAutomatic = automatic.then(() => {
      store.db.prepare("DELETE FROM project_memory_sources WHERE project_id = ? AND kind = 'code'").run(project.id);
    });
    const queuedManual = refreshProjectMemoryIndex(store, project.id, true);
    await removeAfterAutomatic;
    expect((await queuedManual).counts.code).toBe(1);
    store.close();
  });
});
