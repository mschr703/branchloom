import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StudioStore } from '../../src/main/store';
import { apiContractOverview, assertCardApiContractResume, bindCardApiContract, cardApiContractContext, checkApiContractResponse, previewApiContract, recordSessionApiContract, saveApiContract } from '../../src/main/api-contract';
import { reserveCardSession } from '../../src/main/parallel-runs';
import { SessionRunner } from '../../src/main/cli';
import { sessionRunEvidence } from '../../src/main/session-evidence';
import type { ApiContractDraft } from '../../src/shared/api-contract';

const roots: string[] = [];
afterEach(async () => {
  // Windows can retain a ConPTY directory handle briefly after the process exits.
  await new Promise((resolve) => setTimeout(resolve, 300));
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
});
const draft: ApiContractDraft = { method: 'GET', path: '/api/items', response: 'array', fields: [
  { name: 'id', type: 'string', required: true }, { name: 'count', type: 'number', required: true }, { name: 'active', type: 'boolean', required: false },
], error: { status: 404, code: 'NOT_FOUND', message: 'No item found' } };
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-contract-')); roots.push(root);
  const projectPath = join(root, 'project'); mkdirSync(projectPath);
  const file = join(root, 'studio.sqlite');
  const store = new StudioStore(file);
  const project = store.createProject({ name: 'API project', path: projectPath });
  const columnId = store.snapshot(project.id).columns[0]!.id;
  const frontend = store.createCard({ projectId: project.id, columnId, title: 'Frontend' });
  const backend = store.createCard({ projectId: project.id, columnId, title: 'Backend' });
  return { root, file, store, project, frontend, backend };
}
function save(store: StudioStore, projectId: string, next = draft) {
  const preview = previewApiContract(store, { projectId, draft: next });
  return saveApiContract(store, { projectId, draft: next, fingerprint: preview.fingerprint, expectedLatestRevision: preview.expectedLatestRevision });
}
function bind(store: StudioStore, projectId: string, cardId: string, revision: number | null) {
  const overview = apiContractOverview(store, projectId);
  return bindCardApiContract(store, { projectId, cardId, revision, expectedContentRevision: overview.cardRevisions[cardId]! });
}
function git(cwd: string, args: string[]): void {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(String(result.stderr || result.error));
}

describe('shared API contract', () => {
  it('persists exact revisions and sends the same bounded contract to two card agents', () => {
    const { file, store, project, frontend, backend } = fixture();
    const first = save(store, project.id);
    expect(first).toMatchObject({ revision: 1, draft });
    expect(first.example).toEqual([{ id: 'example_id', count: 1, active: true }]);
    bind(store, project.id, frontend.id, 1); bind(store, project.id, backend.id, 1);
    const left = cardApiContractContext(store, frontend.id);
    expect(left).toBe(cardApiContractContext(store, backend.id));
    expect(left).toContain(first.fingerprint);
    store.close();
    const reopened = new StudioStore(file);
    try { expect(apiContractOverview(reopened, project.id).bindings.map((item) => item.revision)).toEqual([1, 1]); expect(cardApiContractContext(reopened, frontend.id)).toBe(left); }
    finally { reopened.close(); }
  });

  it('rejects stale previews and card revisions, marks bindings stale, and preserves prior versions', () => {
    const { store, project, frontend, backend } = fixture();
    const oldPreview = previewApiContract(store, { projectId: project.id, draft });
    save(store, project.id); bind(store, project.id, frontend.id, 1); bind(store, project.id, backend.id, 1);
    expect(() => saveApiContract(store, { projectId: project.id, draft, fingerprint: oldPreview.fingerprint, expectedLatestRevision: oldPreview.expectedLatestRevision })).toThrow('stale');
    const obsoleteCardRevision = apiContractOverview(store, project.id).cardRevisions[frontend.id]!;
    store.updateCard({ id: frontend.id, title: 'Frontend changed' });
    expect(() => bindCardApiContract(store, { projectId: project.id, cardId: frontend.id, revision: 1, expectedContentRevision: obsoleteCardRevision })).toThrow('changed');
    save(store, project.id, { ...draft, fields: [...draft.fields, { name: 'updated', type: 'boolean', required: true }] });
    expect(apiContractOverview(store, project.id).versions.map((item) => item.revision)).toEqual([2, 1]);
    expect(apiContractOverview(store, project.id).bindings.every((item) => !item.current)).toBe(true);
    expect(() => cardApiContractContext(store, backend.id)).toThrow('stale');
    bind(store, project.id, backend.id, 2);
    expect(cardApiContractContext(store, backend.id)).toContain('revision 2');
    expect(() => bind(store, project.id, frontend.id, 1)).toThrow('latest');
    store.close();
  });

  it('checks the exact field, error case, project boundary, and live-card write guard', () => {
    const { root, store, project, frontend } = fixture();
    save(store, project.id);
    const good = checkApiContractResponse(store, { projectId: project.id, revision: 1, status: 200, responseText: '[{"id":"a","count":2}]' });
    expect(good.valid).toBe(true);
    expect(checkApiContractResponse(store, { projectId: project.id, revision: 1, status: 200, responseText: '[{"id":2,"count":"bad"}]' }).mismatches)
      .toEqual([{ path: '$[0].id', expected: 'string', actual: 'number' }, { path: '$[0].count', expected: 'number', actual: 'string' }]);
    expect(checkApiContractResponse(store, { projectId: project.id, revision: 1, status: 404, responseText: '{"error":{"code":"NOT_FOUND","message":"No item found"}}' }).valid).toBe(true);
    expect(checkApiContractResponse(store, { projectId: project.id, revision: 1, status: 200, responseText: '[{"id":"a","count":2,"unexpected":0}]' }).mismatches[0]).toEqual({ path: '$[0].unexpected', expected: 'not defined', actual: 'present' });
    expect(checkApiContractResponse(store, { projectId: project.id, revision: 1, status: 500, responseText: '{}' }).mismatches[0]?.path).toBe('status');
    const otherPath = join(root, 'other'); mkdirSync(otherPath);
    const other = store.createProject({ name: 'Other', path: otherPath });
    expect(() => checkApiContractResponse(store, { projectId: other.id, revision: 1, status: 200, responseText: '{}' })).toThrow('not found');
    expect(() => bindCardApiContract(store, { projectId: other.id, cardId: frontend.id, revision: null, expectedContentRevision: 0 })).toThrow('another project');
    const agent = store.saveAgent({ name: 'Synthetic agent', kind: 'custom', command: process.execPath, args: [], model: null, enabled: true });
    const session = reserveCardSession(store, { cardId: frontend.id, agentId: agent.id });
    expect(() => bind(store, project.id, frontend.id, 1)).toThrow('running');
    store.finishSession(session.id, 'stopped', null);
    expect(() => previewApiContract(store, { projectId: project.id, draft: { ...draft, fields: [{ name: 'id', type: 'uuid' as never, required: true }] } })).toThrow('invalid type');
    store.close();
  });

  it('allows resume only when the conversation saw the card’s current contract revision', () => {
    const { store, project, frontend } = fixture();
    save(store, project.id); bind(store, project.id, frontend.id, 1);
    const agent = store.saveAgent({ name: 'Synthetic agent', kind: 'custom', command: process.execPath, args: [], model: null, enabled: true });
    const session = reserveCardSession(store, { cardId: frontend.id, agentId: agent.id });
    recordSessionApiContract(store, frontend.id, session.id);
    store.finishSession(session.id, 'exited', 0);
    expect(() => assertCardApiContractResume(store, frontend.id, session.id)).not.toThrow();
    save(store, project.id, { ...draft, path: '/api/records' });
    expect(() => assertCardApiContractResume(store, frontend.id, session.id)).toThrow('stale');
    bind(store, project.id, frontend.id, 2);
    expect(() => assertCardApiContractResume(store, frontend.id, session.id)).toThrow('changed');
    store.close();
  });

  it('delivers the bound revision through a real one-shot CLI launch and records its source', async () => {
    const { store, project, frontend } = fixture();
    const contract = save(store, project.id); bind(store, project.id, frontend.id, 1);
    const agent = store.saveAgent({ name: 'Prompt reader', kind: 'custom', command: process.execPath,
      args: ['-e', 'console.log(process.argv[1])', '{prompt}'], model: null, enabled: true });
    let resolveEnd!: () => void;
    const ended = new Promise<void>((resolve) => { resolveEnd = resolve; });
    const runner = new SessionRunner(store, () => undefined, () => resolveEnd());
    try {
      const session = runner.start({ cardId: frontend.id, agentId: agent.id, mode: 'one-shot' });
      await Promise.race([ended, new Promise<void>((_, reject) => setTimeout(() => reject(new Error('CLI did not exit')), 10_000))]);
      expect(store.session(session.id).state).toBe('exited');
      expect(store.session(session.id).output).toContain(contract.fingerprint);
      expect(sessionRunEvidence(store, { projectId: project.id, sessionId: session.id }).launch?.sources).toContain('api-contract');
      const empty = runner.start({ cardId: frontend.id, agentId: agent.id, prompt: '', mode: 'one-shot' });
      for (let attempt = 0; attempt < 40 && store.session(empty.id).state === 'running'; attempt++)
        await new Promise((resolve) => setTimeout(resolve, 50));
      expect(store.session(empty.id).state).toBe('exited');
      expect(sessionRunEvidence(store, { projectId: project.id, sessionId: empty.id }).launch?.sources).toEqual([]);
      expect(store.db.prepare('SELECT session_id FROM session_api_contract_snapshots WHERE session_id = ?').get(empty.id)).toBeUndefined();
    } finally { runner.dispose(); store.close(); }
  }, 15_000);

  it('gives two parallel card agents the same approved revision and rejects both after an update', async () => {
    const { root, file, store, project, frontend, backend } = fixture();
    const repository = join(root, 'project');
    git(repository, ['init', '-q']);
    writeFileSync(join(repository, 'tracked.txt'), 'synthetic project');
    git(repository, ['add', 'tracked.txt']);
    git(repository, ['-c', 'user.name=Branchloom Test', '-c', 'user.email=branchloom-test@example.invalid', 'commit', '-qm', 'Initial fixture']);
    const first = save(store, project.id);
    bind(store, project.id, frontend.id, first.revision);
    bind(store, project.id, backend.id, first.revision);
    const agent = store.saveAgent({ name: 'Synthetic contract reader', kind: 'custom', command: process.execPath,
      args: ['-e', 'console.log(process.argv[1])', '{prompt}'], model: null, enabled: true });
    const runner = new SessionRunner(store, () => undefined, () => undefined);
    try {
      const frontendRun = runner.start({ cardId: frontend.id, agentId: agent.id, mode: 'one-shot', useWorktree: true });
      const backendRun = runner.start({ cardId: backend.id, agentId: agent.id, mode: 'one-shot', useWorktree: true });
      expect(frontendRun.worktreePath).not.toBe(backendRun.worktreePath);
      for (let attempt = 0; attempt < 160 && [frontendRun.id, backendRun.id].some((id) => store.session(id).state === 'running'); attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      for (const session of [frontendRun, backendRun]) {
        expect(store.session(session.id).state).toBe('exited');
        const output = store.session(session.id).output;
        expect(output).toContain(`approved revision 1, sha256 ${first.fingerprint}`);
        expect(output).toContain('example_id');
        expect(output).toContain('NOT_FOUND');
        expect(sessionRunEvidence(store, { projectId: project.id, sessionId: session.id }).launch?.sources).toContain('api-contract');
      }
      const snapshots = store.db.prepare(`SELECT revision, fingerprint FROM session_api_contract_snapshots
        WHERE session_id IN (?, ?) ORDER BY session_id`).all(frontendRun.id, backendRun.id) as Array<{ revision: number; fingerprint: string }>;
      expect(snapshots).toEqual([{ revision: 1, fingerprint: first.fingerprint }, { revision: 1, fingerprint: first.fingerprint }]);

      const second = save(store, project.id, { ...draft, fields: [...draft.fields, { name: 'updated', type: 'boolean', required: true }] });
      expect(second.revision).toBe(2);
      const bindings = apiContractOverview(store, project.id).bindings;
      expect(bindings).toHaveLength(2);
      for (const cardId of [frontend.id, backend.id]) {
        expect(bindings.find((binding) => binding.cardId === cardId)).toMatchObject({ revision: 1, current: false });
      }
      for (const cardId of [frontend.id, backend.id]) {
        expect(() => runner.start({ cardId, agentId: agent.id, mode: 'one-shot', useWorktree: true })).toThrow('stale');
      }
    } finally { runner.dispose(); store.close(); }
    const reopened = new StudioStore(file);
    try {
      expect(apiContractOverview(reopened, project.id).versions.map((version) => version.revision)).toEqual([2, 1]);
      expect(apiContractOverview(reopened, project.id).bindings.every((binding) => !binding.current)).toBe(true);
    } finally { reopened.close(); }
  }, 15_000);
});
