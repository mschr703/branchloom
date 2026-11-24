import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SessionRunner } from '../../src/main/cli';
import { captureRunGit, linkSessionQa, recordSessionVersion, sessionRunEvidence, unlinkSessionQa } from '../../src/main/session-evidence';
import { StudioStore } from '../../src/main/store';

const roots: string[] = [];
afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 200));
  for (const root of roots.splice(0)) {
    try { rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); }
    catch (error) {
      // ConPTY can retain the working directory handle briefly after kill on Windows.
      const code = (error as NodeJS.ErrnoException).code;
      if (process.platform !== 'win32' || !['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(code ?? '')) throw error;
    }
  }
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-run-evidence-'));
  roots.push(root);
  const dbPath = join(root, 'studio.sqlite');
  const store = new StudioStore(dbPath);
  const project = store.createProject({ name: 'Synthetic', path: root });
  const card = store.createCard({ projectId: project.id, columnId: store.snapshot(project.id).columns[0]!.id, title: 'Safe run' });
  const otherCard = store.createCard({ projectId: project.id, columnId: card.columnId, title: 'Other card' });
  const agent = store.saveAgent({ name: 'Local node', kind: 'custom', command: process.execPath,
    args: ['-e', 'process.stdin.resume(); setInterval(() => {}, 1000)'], model: 'configured-fixture', enabled: true });
  return { root, dbPath, store, project, card, otherCard, agent };
}

function insertQa(store: StudioStore, projectId: string, cardId: string, startedAt: string, status: string) {
  const id = randomUUID();
  store.db.prepare(`INSERT INTO card_qa_reports (id, card_id, project_id, requested_url, final_url, started_at, ended_at, status, diagnostics_json,
    viewport_width, viewport_height) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', 390, 844)`)
    .run(id, cardId, projectId, 'http://127.0.0.1:3000/', null, startedAt, new Date(Date.parse(startedAt) + 1000).toISOString(), status);
  return id;
}

describe('per-session launch and QA evidence', () => {
  it('records only observed local launch fields, keeps prompt text out and survives restart', async () => {
    const { store, dbPath, project, card, agent } = fixture();
    const runner = new SessionRunner(store, () => undefined, () => undefined);
    try {
      const run = runner.start({ cardId: card.id, agentId: agent.id, prompt: 'PRIVATE_SYNTHETIC_PROMPT', mode: 'interactive' });
      const evidence = sessionRunEvidence(store, { projectId: project.id, sessionId: run.id });
      expect(evidence.launch).toMatchObject({ agentName: agent.name, agentKind: 'custom', mode: 'interactive',
        configuredModel: 'configured-fixture', configuredEffort: null, sources: ['manual-prompt'], promptDelivery: 'pty-delayed',
        versionCheck: 'unchecked', git: { scope: 'project', head: null, dirty: null } });
      expect(JSON.stringify(evidence)).not.toContain('PRIVATE_SYNTHETIC_PROMPT');
      for (let attempt = 0; attempt < 30 && sessionRunEvidence(store, { projectId: project.id, sessionId: run.id }).launch?.promptDelivery !== 'pty-written'; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(sessionRunEvidence(store, { projectId: project.id, sessionId: run.id }).launch?.promptDelivery).toBe('pty-written');
      recordSessionVersion(store, run.id, 'ready', 'synthetic-cli 1.0');
      expect(sessionRunEvidence(store, { projectId: project.id, sessionId: run.id }).launch?.version).toBe('synthetic-cli 1.0');
      runner.stop(run.id);
      store.saveAgent({ ...agent, model: 'changed-later' });
      expect(sessionRunEvidence(store, { projectId: project.id, sessionId: run.id }).launch?.configuredModel).toBe('configured-fixture');
      const emptyRun = runner.start({ cardId: card.id, agentId: agent.id, prompt: '', mode: 'interactive' });
      expect(sessionRunEvidence(store, { projectId: project.id, sessionId: emptyRun.id }).launch).toMatchObject({ sources: [], promptDelivery: 'none', configuredModel: 'changed-later' });
      runner.stop(emptyRun.id);
      runner.dispose(); store.close();
      const reopened = new StudioStore(dbPath);
      try { expect(sessionRunEvidence(reopened, { projectId: project.id, sessionId: run.id }).launch?.sources).toEqual(['manual-prompt']); }
      finally { reopened.close(); }
    } finally { runner.dispose(); if (store.db.open) store.close(); }
  }, 15_000);

  it('bounds QA links to the same card and after run start, without interpreting failed reports as success', () => {
    const { store, dbPath, project, card, otherCard, agent } = fixture();
    try {
      const run = store.createSession({ cardId: card.id, agentId: agent.id });
      expect(sessionRunEvidence(store, { projectId: project.id, sessionId: run.id }).launch).toBeNull();
      const before = insertQa(store, project.id, card.id, new Date(Date.parse(run.startedAt) - 1000).toISOString(), 'passed');
      const other = insertQa(store, project.id, otherCard.id, new Date(Date.parse(run.startedAt) + 1000).toISOString(), 'passed');
      const failed = insertQa(store, project.id, card.id, new Date(Date.parse(run.startedAt) + 1000).toISOString(), 'failed');
      expect(() => linkSessionQa(store, { projectId: project.id, sessionId: run.id, reportId: before })).toThrow('vor dem Agentenlauf');
      expect(() => linkSessionQa(store, { projectId: project.id, sessionId: run.id, reportId: other })).toThrow('nicht zu diesem Kartenlauf');
      const linked = linkSessionQa(store, { projectId: project.id, sessionId: run.id, reportId: failed });
      expect(linked.linkedQa).toMatchObject([{ reportId: failed, status: 'failed', viewportWidth: 390 }]);
      const reopened = new StudioStore(dbPath);
      try { expect(sessionRunEvidence(reopened, { projectId: project.id, sessionId: run.id }).linkedQa).toMatchObject([{ reportId: failed, status: 'failed' }]); }
      finally { reopened.close(); }
      expect(() => linkSessionQa(store, { projectId: project.id, sessionId: run.id, reportId: failed })).toThrow('bereits zugeordnet');
      expect(() => sessionRunEvidence(store, { projectId: 'wrong-project', sessionId: run.id })).toThrow();
      store.setCardArchived({ id: card.id, archived: true });
      expect(() => unlinkSessionQa(store, { projectId: project.id, sessionId: run.id, reportId: failed })).toThrow('Archivierte Karte');
      store.setCardArchived({ id: card.id, archived: false });
      expect(unlinkSessionQa(store, { projectId: project.id, sessionId: run.id, reportId: failed }).linkedQa).toEqual([]);
      expect(() => unlinkSessionQa(store, { projectId: project.id, sessionId: run.id, reportId: failed })).toThrow('nicht zugeordnet');
    } finally { store.close(); }
  });

  it('captures a bounded Git point before launch without reading files or inventing a HEAD', () => {
    const { root, store } = fixture();
    try {
      expect(captureRunGit(root, 'project')).toMatchObject({ head: null, dirty: null });
      const git = (...args: string[]) => { const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout: 10_000, windowsHide: true }); if (result.status !== 0) throw new Error(result.stderr); return result.stdout.trim(); };
      git('init', '-q'); writeFileSync(join(root, 'tracked.txt'), 'one'); git('add', 'tracked.txt');
      git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'first');
      expect(captureRunGit(root, 'project')).toMatchObject({ head: git('rev-parse', 'HEAD'), dirty: true }); // Local SQLite is untracked.
      writeFileSync(join(root, 'tracked.txt'), 'two');
      expect(captureRunGit(root, 'project').dirty).toBe(true);
    } finally { store.close(); }
  });
});
